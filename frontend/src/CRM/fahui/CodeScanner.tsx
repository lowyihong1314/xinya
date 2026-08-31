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
/** 变焦 / 微距的档位记在本机：师傅每次开摄像头不用重调一遍 */
const OPTICS_KEY = "ylp.scanner.optics";

type Range = { min: number; max: number; step: number };

/** getCapabilities() 回的那几个键 TS 的 MediaTrackCapabilities 里没有，自己描一份。 */
type OpticCaps = {
  zoom?: { min?: number; max?: number; step?: number };
  focusDistance?: { min?: number; max?: number; step?: number };
  focusMode?: string[];
  pointsOfInterest?: unknown;
};

type Optics = { zoom: number | null; macro: boolean; distance: number | null; digital: number };

/** 没有硬件变焦时的软件放大上限。再大就只是把马赛克放大，没意义。 */
const DIGITAL_ZOOM_MAX = 4;

function toRange(raw: OpticCaps["zoom"]): Range | null {
  const min = Number(raw?.min);
  const max = Number(raw?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }
  const step = Number(raw?.step);
  return { min, max, step: Number.isFinite(step) && step > 0 ? step : (max - min) / 100 };
}

function loadOptics(): Optics {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPTICS_KEY) || "{}") as Partial<Optics>;
    return {
      zoom: typeof parsed.zoom === "number" ? parsed.zoom : null,
      macro: Boolean(parsed.macro),
      distance: typeof parsed.distance === "number" ? parsed.distance : null,
      digital: typeof parsed.digital === "number" ? Math.min(DIGITAL_ZOOM_MAX, Math.max(1, parsed.digital)) : 1,
    };
  } catch {
    // 无痕窗口 / 禁了站点数据都会抛，当作没存过
    return { zoom: null, macro: false, distance: null, digital: 1 };
  }
}

function saveOptics(optics: Optics) {
  try {
    window.localStorage.setItem(OPTICS_KEY, JSON.stringify(optics));
  } catch {
    /* 存不了就算了，不影响扫码 */
  }
}

/** 夹回合法区间，并对齐到 step —— 有些机器给了区间外的值会直接拒掉整条约束。 */
function clamp(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}

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

  // 牌位上的 QR / 条码只有指甲盖大，普通自动对焦在 10cm 内根本合不上焦，
  // 拉远又小到解不出来。所以把镜头的两个旋钮直接交给使用者：
  //   放大 —— track 的 zoom，把小码在画面里撑大（数码变焦也够 jsQR 用）
  //   微距 —— focusMode:"manual" + focusDistance 拉到最近，贴着牌位也清楚
  // 两个都读 getCapabilities()，机器不支持就不显示对应的控件。
  const [zoomRange, setZoomRange] = useState<Range | null>(null);
  const [distanceRange, setDistanceRange] = useState<Range | null>(null);
  const [optics, setOptics] = useState<Optics>(() => loadOptics());
  const opticsRef = useRef(optics);
  opticsRef.current = optics;

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

  /** 把档位推给摄像头。变焦和对焦分两次 apply：某些机器一条里混了不认的键会整条拒掉。 */
  const pushOptics = useCallback(async (next: Optics) => {
    const track = trackRef.current;
    if (!track?.applyConstraints) {
      return;
    }
    // 这些键在 TS 的 MediaTrackConstraints 里没定义，但浏览器认
    const apply = async (constraint: Record<string, unknown>) => {
      try {
        await track.applyConstraints({ advanced: [constraint] } as unknown as MediaTrackConstraints);
      } catch {
        /* 这颗摄像头不吃这一档 */
      }
    };
    if (next.zoom != null) {
      await apply({ zoom: next.zoom });
    }
    // distance 非空 = 这颗镜头支持 manual 对焦，关微距时要主动交回连续自动对焦，
    // 否则镜头会一直卡在上次锁定的距离上。
    if (next.distance != null) {
      await apply(next.macro ? { focusMode: "manual", focusDistance: next.distance } : { focusMode: "continuous" });
    }
  }, []);

  const updateOptics = useCallback(
    (patch: Partial<Optics>) => {
      const next = { ...opticsRef.current, ...patch };
      opticsRef.current = next;
      setOptics(next);
      saveOptics(next);
      void pushOptics(next);
    },
    [pushOptics],
  );

  const start = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("这个浏览器不支持摄像头。注意：非 HTTPS 的地址一律拿不到摄像头。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 码本身小，采集分辨率直接顶到 1080p：同样大的码能多摊到一倍多的像素，
        // 解码成功率差很多。拿不到这么高的机器浏览器会自己往下退。
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] || null;
      trackRef.current = track;
      const caps = (track?.getCapabilities?.() || {}) as OpticCaps;
      setFocusSupported(Boolean(caps.focusMode?.length || caps.pointsOfInterest));

      const zoom = toRange(caps.zoom);
      // focusDistance 按规范是「米」，min 就是最近的那一档 —— 微距要的就是它
      const distance = caps.focusMode?.includes("manual") ? toRange(caps.focusDistance) : null;
      setZoomRange(zoom);
      setDistanceRange(distance);

      const saved = opticsRef.current;
      const restored: Optics = {
        zoom: zoom ? clamp(saved.zoom ?? zoom.min, zoom) : null,
        macro: Boolean(distance) && saved.macro,
        distance: distance ? clamp(saved.distance ?? distance.min, distance) : null,
        // 有硬件变焦就不用软件裁了，硬件那份画质好得多
        digital: zoom ? 1 : saved.digital,
      };
      setOptics(restored);
      opticsRef.current = restored;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // 约束要等流真的跑起来再推，刚 getUserMedia 完就 apply 有些机器会静默忽略
      await pushOptics(restored);
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
      const frameWidth = video.videoWidth;
      const frameHeight = video.videoHeight;
      if (frameWidth && frameHeight) {
        // 软件放大 = 只取画面正中的一块来解码。像素密度没变（放大不出信息），
        // 但周围那些牌位的字、别人的码都被切掉了，jsQR 少走很多弯路，也快一截。
        const factor = Math.max(1, opticsRef.current.digital);
        const width = Math.round(frameWidth / factor);
        const height = Math.round(frameHeight / factor);
        const sourceX = Math.round((frameWidth - width) / 2);
        const sourceY = Math.round((frameHeight - height) / 2);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, sourceX, sourceY, width, height, 0, 0, width, height);
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
  }, [pushOptics]);

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

  // 每秒把焦点拉回画面正中；手动点过之后让路 3 秒，不然刚点的地方一秒就被抢回去。
  // 微距是手动锁死的距离，这时候再去自动对焦等于把用户刚调好的档位推翻。
  useEffect(() => {
    if (!running || !focusSupported || optics.macro) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - manualFocusAtRef.current < MANUAL_FOCUS_GRACE_MS) {
        return;
      }
      void applyFocus(0.5, 0.5);
    }, AUTOFOCUS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running, focusSupported, optics.macro, applyFocus]);

  async function focusAt(event: ReactPointerEvent<HTMLDivElement>) {
    if (opticsRef.current.macro) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    manualFocusAtRef.current = Date.now();
    setFocusRing({ x: event.clientX - rect.left, y: event.clientY - rect.top, id: Date.now() });
    window.setTimeout(() => setFocusRing((current) => (current && Date.now() - current.id > 500 ? null : current)), 700);
    await applyFocus((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }

  return (
    <div style={{ ...styles.wrap, height }} onPointerDown={(event) => void focusAt(event)} className="code-scanner">
      <style>{SCANNER_CSS}</style>
      {/* 预览也跟着放大，不然画面里看着小小一个、实际解码的是裁过的中间那块，
          人会以为没对准。transform 以中心为原点，和上面的裁切是同一块区域。 */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={optics.digital > 1 ? { ...styles.video, transform: `scale(${optics.digital})` } : styles.video}
      />
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
        // 滑杆压在画面上，所以要拦住 pointerdown —— 不然拖滑杆同时会触发点画面对焦
        <div
          style={styles.optics}
          className="code-scanner-optics"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {distanceRange ? (
            <div style={styles.opticsRow}>
              <button
                type="button"
                style={{ ...styles.macroButton, ...(optics.macro ? styles.macroButtonOn : null) }}
                onClick={() =>
                  updateOptics({
                    macro: !optics.macro,
                    // 一开微距就先顶到最近的一档，牌位贴到镜头上也是清楚的
                    distance: optics.macro ? optics.distance : distanceRange.min,
                  })
                }
              >
                <i className="fa-solid fa-seedling" style={{ marginRight: 6 }} />
                {optics.macro ? "微距开" : "微距"}
              </button>
              {optics.macro ? (
                <>
                  <span style={styles.opticsLabel}>近</span>
                  <input
                    type="range"
                    style={styles.slider}
                    min={distanceRange.min}
                    max={distanceRange.max}
                    step={distanceRange.step}
                    value={optics.distance ?? distanceRange.min}
                    onChange={(event) => updateOptics({ distance: Number(event.target.value) })}
                  />
                  <span style={styles.opticsLabel}>远</span>
                </>
              ) : (
                <span style={styles.opticsHint}>点画面可对焦</span>
              )}
            </div>
          ) : null}

          <div style={styles.opticsRow}>
            <span style={styles.opticsLabel}>
              <i className="fa-solid fa-magnifying-glass" />
            </span>
            {zoomRange ? (
              <>
                <input
                  type="range"
                  style={styles.slider}
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={zoomRange.step}
                  value={optics.zoom ?? zoomRange.min}
                  onChange={(event) => updateOptics({ zoom: Number(event.target.value) })}
                />
                <span style={styles.opticsValue}>{`${(optics.zoom ?? zoomRange.min).toFixed(1)}×`}</span>
              </>
            ) : (
              <>
                <input
                  type="range"
                  style={styles.slider}
                  min={1}
                  max={DIGITAL_ZOOM_MAX}
                  step={0.25}
                  value={optics.digital}
                  onChange={(event) => updateOptics({ digital: Number(event.target.value) })}
                />
                <span style={styles.opticsValue}>{`${optics.digital.toFixed(2).replace(/\.?0+$/, "")}×`}</span>
              </>
            )}
          </div>
        </div>
      ) : null}
      {running ? (
        <span style={styles.badge}>
          {optics.macro
            ? "微距已锁 · 贴近牌位，用滑杆微调"
            : focusSupported
              ? "每秒自动对焦中心 · 点画面可改"
              : "对准中心十字"}
        </span>
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
  optics: {
    position: "absolute",
    left: "8px",
    right: "8px",
    // 让开底部那条 badge
    bottom: "30px",
    display: "grid",
    gap: "6px",
    padding: "7px 10px",
    borderRadius: "10px",
    background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(2px)",
  },
  opticsRow: { display: "flex", alignItems: "center", gap: "8px" },
  opticsLabel: { color: "#fff", fontSize: "11px", opacity: 0.85, flex: "0 0 auto" },
  opticsHint: { color: "#fff", fontSize: "11px", opacity: 0.7 },
  opticsValue: {
    color: "#fbbf24",
    fontSize: "11.5px",
    fontWeight: 700,
    flex: "0 0 auto",
    // 数字跳动时别把滑杆挤得左右晃
    minWidth: "34px",
    textAlign: "right",
  },
  slider: { flex: 1, minWidth: 0, accentColor: "#fbbf24", height: "22px" },
  macroButton: {
    flex: "0 0 auto",
    padding: "5px 11px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.45)",
    background: "transparent",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  macroButtonOn: {
    borderColor: "#fbbf24",
    background: "#fbbf24",
    color: "#1f2937",
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
