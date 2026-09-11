import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const OUTPUT_SIZE = 360;
const JPEG_QUALITY = 0.75;

/**
 * Front-camera selfie for the entry step. Live preview where the browser allows
 * it; otherwise the phone's own camera app via a file input. The picture is
 * cropped square and downscaled here so what leaves the phone is ~30KB.
 */
export function SelfieCapture({ photo, onCaptured }: { photo: string; onCaptured: (dataUrl: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (photo) return;
    let cancelled = false;

    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraFailed(true);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch {
        if (!cancelled) setCameraFailed(true);
      }
    }

    void openCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, [photo]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror it back: the preview is flipped, the saved photo should not be.
    ctx.translate(OUTPUT_SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );
    onCaptured(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    stopCamera();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onCaptured(await squareDownscale(file));
    } finally {
      setBusy(false);
    }
  }

  if (photo) {
    return (
      <div style={wrapStyle}>
        <img src={photo} alt="你的自拍" style={previewStyle} />
        <button type="button" onClick={() => onCaptured("")} style={retakeBtnStyle}>
          <i className="fas fa-rotate-left" aria-hidden="true" /> 重拍
        </button>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      {!cameraFailed ? (
        <>
          <video ref={videoRef} playsInline muted autoPlay style={videoStyle} />
          <button type="button" onClick={shoot} disabled={!cameraReady} style={shootBtnStyle}>
            <i className="fas fa-camera" aria-hidden="true" /> {cameraReady ? "拍照" : "开启相机中…"}
          </button>
        </>
      ) : (
        <>
          <div style={hintStyle}>用不了实时相机，点下面直接用手机相机拍一张正脸。</div>
          <label style={fileBtnStyle}>
            <i className="fas fa-camera" aria-hidden="true" /> {busy ? "处理中…" : "拍一张正脸"}
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </label>
        </>
      )}
    </div>
  );
}

/** Centre-crop to a square and shrink, so a 4MB camera photo leaves as ~30KB. */
async function squareDownscale(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取照片失败"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("照片无法解析"));
    img.src = dataUrl;
  });
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

const wrapStyle: CSSProperties = { display: "grid", gap: "12px", justifyItems: "center" };
const videoStyle: CSSProperties = {
  width: "min(260px, 70vw)",
  height: "min(260px, 70vw)",
  borderRadius: "999px",
  objectFit: "cover",
  background: "var(--x-color-panel-alt)",
  transform: "scaleX(-1)",
};
const previewStyle: CSSProperties = {
  width: "min(260px, 70vw)",
  height: "min(260px, 70vw)",
  borderRadius: "999px",
  objectFit: "cover",
  border: "3px solid var(--x-color-accent)",
};
const shootBtnStyle: CSSProperties = {
  minHeight: "50px",
  padding: "0 28px",
  border: "none",
  borderRadius: "999px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "17px",
  fontWeight: 900,
  cursor: "pointer",
};
const retakeBtnStyle: CSSProperties = {
  minHeight: "44px",
  padding: "0 22px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "999px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const fileBtnStyle: CSSProperties = {
  minHeight: "50px",
  padding: "0 28px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  borderRadius: "999px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "17px",
  fontWeight: 900,
  cursor: "pointer",
};
const hintStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
  textAlign: "center",
  lineHeight: 1.6,
};
