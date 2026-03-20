import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import Hls from "hls.js";

function ptzMove(x: number, y: number, z = 0) {
  void fetch("/api/move_camera/ptz/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y, z }),
  });
}

function ptzStop() {
  void fetch("/api/move_camera/ptz/stop", { method: "POST" });
}

function CCTVPlayerModal({
  hlsUrl,
  onClose,
}: {
  hlsUrl: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDuration: 2,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
      video.pause();
    };
  }, [hlsUrl]);

  function PtzButton({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) {
    return (
      <button
        type="button"
        style={ptzButtonStyle}
        onMouseDown={onPress}
        onMouseUp={ptzStop}
        onMouseLeave={ptzStop}
        onTouchStart={(event) => {
          event.preventDefault();
          onPress();
        }}
        onTouchEnd={ptzStop}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <button type="button" style={closeButtonStyle} onClick={onClose}>
          ✕
        </button>
        <video ref={videoRef} controls autoPlay muted playsInline style={videoStyle} />
        <div style={ptzGridStyle}>
          <div />
          <PtzButton label="▲" onPress={() => ptzMove(0, 0.3)} />
          <div />
          <PtzButton label="◀" onPress={() => ptzMove(-0.3, 0)} />
          <PtzButton label="■" onPress={ptzStop} />
          <PtzButton label="▶" onPress={() => ptzMove(0.3, 0)} />
          <div />
          <PtzButton label="▼" onPress={() => ptzMove(0, -0.3)} />
          <div />
        </div>
      </div>
    </div>
  );
}

export function showCCTVModal(hlsUrl = "/cctv_rdsp_converd/cam1/live.m3u8") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const close = () => {
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };

  root.render(<CCTVPlayerModal hlsUrl={hlsUrl} onClose={close} />);
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
};

const modalStyle: CSSProperties = {
  width: "min(900px, 100%)",
  background: "#000",
  borderRadius: "10px",
  padding: "12px",
  position: "relative",
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: "8px",
  right: "12px",
  color: "#fff",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: "18px",
};

const videoStyle: CSSProperties = {
  width: "100%",
  borderRadius: "6px",
};

const ptzGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "50px 50px 50px",
  gridTemplateRows: "50px 50px 50px",
  gap: "6px",
  justifyContent: "center",
  marginTop: "12px",
};

const ptzButtonStyle: CSSProperties = {
  background: "#222",
  color: "#fff",
  border: "1px solid #444",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "16px",
};
