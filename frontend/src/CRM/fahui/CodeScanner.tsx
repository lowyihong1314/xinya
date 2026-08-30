import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import jsQR from "jsqr";

// 摄像头扫码的公用件：看板手机端（扫到直接上板）和打印弹窗（扫到往清单里加单号）共用。
//
// 抽出来是因为这段东西的坑都在细节上 —— BarcodeDetector 与 jsQR 的取舍、
// 解码节流、对焦、资源释放 —— 复制两份迟早各自漂移。
// 上层只管拿 onCode 回来的字符串，怎么用它自己决定。

/** 每帧都解码太费电，隔几帧扫一次够用了 */
const SCAN_INTERVAL_MS = 220;
/** 自动对焦中心点的间隔。手一直在动，不定时拉回来很容易糊 */
const AUTOFOCUS_INTERVAL_MS = 1000;
/** 手动点过之后，自动对焦让路多久 */
const MANUAL_FOCUS_GRACE_MS = 3000;

export function CodeScanner({
  active,
  onCode,
  height = "100%",
  showGuides = true,
}: {
  /** false 就关摄像头。弹窗收起、切走 tab 时把它设 false，别让相机一直亮着 */
  active: boolean;
  onCode: (code: string) => void;
  /** 撑满父容器传 "100%"，嵌在弹窗里给个固定高度 */
  height?: string;
  showGuides?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const manualFocusAtRef = useRef(0);
  const detectorRef = useRef<{ detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> } | null>(null);
  // onCode 放 ref 里：上层多半传行内箭头函数，进依赖会把摄像头反复重启
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [focusSupported, setFocusSupported] = useState(false);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; id: number } | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("这个浏览器不支持摄像头。注意：非 HTTPS 的地址一律拿不到摄像头。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] || null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() || {}) as { focusMode?: string[]; pointsOfInterest?: unknown };
      setFocusSupported(Boolean(caps.focusMode?.length || caps.pointsOfInterest));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "没给摄像头权限。到浏览器设置里允许后重进这一页。"
          : "打不开摄像头，检查是不是被别的程序占用了",
      );
      return;
    }

    // 优先用浏览器原生的 BarcodeDetector：它认 Code128 条码，jsQR 只认 QR。
    // 牌位上两种都印了，所以退回 jsQR 也能扫，只是要对准二维码那个。
    const AnyWindow = window as unknown as { BarcodeDetector?: unknown };
    if (AnyWindow.BarcodeDetector) {
      try {
        detectorRef.current = new (AnyWindow.BarcodeDetector as new (init: { formats: string[] }) => {
          detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
        })({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
      } catch {
        detectorRef.current = null;
      }
    }

    setRunning(true);

    const tick = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !streamRef.current) {
        return;
      }
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width && height) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          let code = "";
          if (detectorRef.current) {
            try {
              const found = await detectorRef.current.detect(canvas);
              code = found[0]?.rawValue || "";
            } catch {
              detectorRef.current = null;
            }
          }
          if (!code) {
            const image = ctx.getImageData(0, 0, width, height);
            code = jsQR(image.data, width, height)?.data || "";
          }
          if (code) {
            onCodeRef.current(code.trim());
          }
        }
      }
      timerRef.current = window.setTimeout(() => {
        rafRef.current = window.requestAnimationFrame(() => void tick());
      }, SCAN_INTERVAL_MS);
    };
    rafRef.current = window.requestAnimationFrame(() => void tick());
  }, []);

  useEffect(() => {
    if (active) {
      void start();
    } else {
      stop();
    }
    return stop;
  }, [active, start, stop]);

  /** 把对焦点喂给摄像头。x/y 是 0~1 的归一化坐标。 */
  const applyFocus = useCallback(async (x: number, y: number) => {
    const track = trackRef.current;
    if (!track?.applyConstraints) {
      return;
    }
    const caps = (track.getCapabilities?.() || {}) as { focusMode?: string[] };
    const mode = caps.focusMode?.includes("single-shot")
      ? "single-shot"
      : caps.focusMode?.includes("manual")
        ? "manual"
        : caps.focusMode?.includes("continuous")
          ? "continuous"
          : null;
    try {
      await track.applyConstraints({
        // 这两个键在 TS 的 MediaTrackConstraints 里没有定义，但浏览器认
        advanced: [{ pointsOfInterest: [{ x, y }], ...(mode ? { focusMode: mode } : {}) }],
      } as unknown as MediaTrackConstraints);
    } catch {
      /* 这颗摄像头不吃这套 */
    }
  }, []);

  // 每秒把焦点拉回画面正中；手动点过之后让路 3 秒，不然刚点的地方一秒就被抢回去
  useEffect(() => {
    if (!running || !focusSupported) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - manualFocusAtRef.current < MANUAL_FOCUS_GRACE_MS) {
        return;
      }
      void applyFocus(0.5, 0.5);
    }, AUTOFOCUS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, focusSupported, applyFocus]);

  async function focusAt(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    manualFocusAtRef.current = Date.now();
    setFocusRing({ x: event.clientX - rect.left, y: event.clientY - rect.top, id: Date.now() });
    window.setTimeout(() => setFocusRing((current) => (current && Date.now() - current.id > 500 ? null : current)), 700);
    await applyFocus((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }

  return (
    <div style={{ ...styles.wrap, height }} onPointerDown={(event) => void focusAt(event)} className="code-scanner">
      <style>{SCANNER_CSS}</style>
      <video ref={videoRef} muted playsInline style={styles.video} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {showGuides ? (
        <>
          <div style={styles.reticle} />
          {/* 中心十字：自动对焦对的就是这个点，把码摆在交点上最容易扫中。
              只画中间一段，横贯整屏的线会盖住牌位上的字。 */}
          <div style={styles.guides}>
            <span style={styles.guideH} />
            <span style={styles.guideV} />
            <span style={styles.guideBox} />
          </div>
        </>
      ) : null}
      {focusRing ? (
        <span key={focusRing.id} style={{ ...styles.focusRing, left: `${focusRing.x}px`, top: `${focusRing.y}px` }} />
      ) : null}
      {error ? (
        <div style={styles.error}>
          <p style={{ margin: 0 }}>{error}</p>
          <button type="button" style={styles.retry} onClick={() => void start()}>
            重试
          </button>
        </div>
      ) : null}
      {running ? (
        <span style={styles.badge}>{focusSupported ? "每秒自动对焦中心 · 点画面可改" : "对准中心十字"}</span>
      ) : null}
    </div>
  );
}

const SCANNER_CSS = `
@keyframes codeScannerFocus {
  from { transform: translate(-50%, -50%) scale(1.5); opacity: 0.9; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}
`;

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    width: "100%",
    minHeight: 0,
    borderRadius: "12px",
    overflow: "hidden",
    background: "#000",
    touchAction: "manipulation",
  },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  reticle: {
    position: "absolute",
    inset: "18% 12%",
    border: "2px solid rgba(255,255,255,0.85)",
    borderRadius: "12px",
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
    pointerEvents: "none",
  },
  guides: { position: "absolute", inset: 0, pointerEvents: "none" },
  guideH: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "26%",
    height: "1px",
    transform: "translate(-50%, -50%)",
    background: "rgba(251,191,36,0.9)",
  },
  guideV: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "1px",
    height: "26%",
    transform: "translate(-50%, -50%)",
    background: "rgba(251,191,36,0.9)",
  },
  guideBox: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "56px",
    height: "56px",
    marginLeft: "-28px",
    marginTop: "-28px",
    border: "1.5px solid rgba(251,191,36,0.75)",
    borderRadius: "8px",
  },
  focusRing: {
    position: "absolute",
    width: "68px",
    height: "68px",
    borderRadius: "50%",
    border: "2px solid #fbbf24",
    transform: "translate(-50%, -50%)",
    animation: "codeScannerFocus 0.65s ease-out forwards",
    pointerEvents: "none",
  },
  error: {
    position: "absolute",
    inset: 0,
    display: "grid",
    gap: "10px",
    placeContent: "center",
    padding: "20px",
    textAlign: "center",
    background: "rgba(0,0,0,0.72)",
    color: "#fff",
    fontSize: "13px",
    lineHeight: 1.6,
  },
  retry: {
    justifySelf: "center",
    padding: "8px 18px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "13.5px",
    fontWeight: 700,
    cursor: "pointer",
  },
  badge: {
    position: "absolute",
    left: "50%",
    bottom: "8px",
    transform: "translateX(-50%)",
    padding: "3px 10px",
    borderRadius: "999px",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    fontSize: "11px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
};
