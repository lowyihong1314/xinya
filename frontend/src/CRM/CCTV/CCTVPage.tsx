import { useEffect, useRef, useState, type CSSProperties } from "react";
import Hls from "hls.js";

import { apiFetch } from "../../js/apiFetch";
import { useEnsureDesignTokens } from "../../theme/designTokens";

const HLS_URL = "/cctv_rdsp_converd/cam1/live.m3u8";

function ptzMove(x: number, y: number, z = 0) {
  void apiFetch("/api/move_camera/ptz/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y, z }),
  });
}

function ptzStop() {
  void apiFetch("/api/move_camera/ptz/stop", { method: "POST" });
}

export function CCTVPage() {
  useEnsureDesignTokens();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, liveSyncDuration: 4, manifestLoadingMaxRetry: 8 });
      hls.loadSource(HLS_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("live");
        void video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setStatus("error");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = HLS_URL;
      video.addEventListener("loadedmetadata", () => setStatus("live"));
      video.addEventListener("error", () => setStatus("error"));
    } else {
      setStatus("error");
    }

    return () => {
      hls?.destroy();
      video.pause();
    };
  }, []);

  return (
    <section style={styles.page}>
      <header style={styles.head}>
        <div>
          <p style={styles.eyebrow}>CCTV</p>
          <h2 style={styles.title}>监控</h2>
        </div>
        <span
          style={{
            ...styles.badge,
            ...(status === "live" ? styles.badgeLive : status === "error" ? styles.badgeErr : styles.badgeLoad),
          }}
        >
          {status === "live" ? "● 直播中" : status === "error" ? "连接失败" : "连接中…"}
        </span>
      </header>

      <div style={styles.playerWrap}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} style={styles.video} autoPlay muted playsInline controls />
        {status === "error" ? (
          <div style={styles.overlayMsg}>无法连接直播流，请稍后重试或检查转流服务。</div>
        ) : null}
      </div>

      <div style={styles.controls}>
        <p style={styles.controlsTitle}>云台控制（按住移动）</p>
        <div style={styles.padRow}>
          <div style={styles.dpad}>
            <div />
            <PtzButton label="▲" onPress={() => ptzMove(0, 0.4)} />
            <div />
            <PtzButton label="◀" onPress={() => ptzMove(-0.4, 0)} />
            <PtzButton label="■" onPress={ptzStop} />
            <PtzButton label="▶" onPress={() => ptzMove(0.4, 0)} />
            <div />
            <PtzButton label="▼" onPress={() => ptzMove(0, -0.4)} />
            <div />
          </div>
          <div style={styles.zoomCol}>
            <PtzButton label="放大 +" onPress={() => ptzMove(0, 0, 0.4)} wide />
            <PtzButton label="缩小 −" onPress={() => ptzMove(0, 0, -0.4)} wide />
          </div>
        </div>
      </div>
    </section>
  );
}

function PtzButton({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      style={{ ...styles.ptzBtn, ...(wide ? styles.ptzWide : {}) }}
      onMouseDown={onPress}
      onMouseUp={ptzStop}
      onMouseLeave={ptzStop}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress();
      }}
      onTouchEnd={ptzStop}
    >
      {label}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: "14px", fontFamily: "var(--x-font-sans)", color: "var(--x-color-ink)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  eyebrow: { margin: 0, fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "var(--x-color-accent)" },
  title: { margin: "3px 0 0", fontSize: "20px", fontWeight: 800 },
  badge: { fontSize: "12px", fontWeight: 700, padding: "4px 12px", borderRadius: "999px" },
  badgeLive: { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" },
  badgeErr: { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" },
  badgeLoad: { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" },
  playerWrap: { position: "relative", width: "100%", maxWidth: 960, aspectRatio: "16 / 9", background: "#000", borderRadius: "var(--x-radius-md)", overflow: "hidden", boxShadow: "0 16px 40px var(--x-color-shadow)" },
  video: { width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" },
  overlayMsg: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", textAlign: "center", padding: "16px" },
  controls: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", maxWidth: 960 },
  controlsTitle: { margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" },
  padRow: { display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" },
  dpad: { display: "grid", gridTemplateColumns: "repeat(3, 52px)", gridTemplateRows: "repeat(3, 52px)", gap: "6px" },
  zoomCol: { display: "flex", flexDirection: "column", gap: "6px" },
  ptzBtn: { display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "10px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "18px", fontWeight: 700, cursor: "pointer", userSelect: "none", WebkitUserSelect: "none" },
  ptzWide: { padding: "12px 18px", fontSize: "14px", whiteSpace: "nowrap" },
};
