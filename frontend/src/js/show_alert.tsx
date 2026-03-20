import { createRoot } from "react-dom/client";

type AlertStatus = "success" | "error" | "loading";

function AlertModal({
  status,
  message,
  onClose,
}: {
  status: AlertStatus;
  message: string;
  onClose: () => void;
}) {
  const colors = {
    success: "#2e7d32",
    error: "#d32f2f",
    loading: "#1976d2",
  } as const;

  return (
    <div style={overlayStyle}>
      <div style={{ ...boxStyle, borderLeft: `6px solid ${colors[status]}` }}>
        <div style={iconWrapStyle}>
          {status === "loading" ? <div style={{ ...spinnerStyle, borderTopColor: colors.loading }} /> : null}
          {status === "success" ? <div style={{ ...emojiStyle, color: colors.success }}>✓</div> : null}
          {status === "error" ? <div style={{ ...emojiStyle, color: colors.error }}>✕</div> : null}
        </div>

        <div style={messageStyle}>{message}</div>

        {status !== "loading" ? (
          <button type="button" style={{ ...buttonStyle, background: colors[status] }} onClick={onClose}>
            OK
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function show_alert(status: AlertStatus, message: string) {
  document.querySelectorAll("[data-xinya-alert-root='true']").forEach((node) => node.remove());

  const host = document.createElement("div");
  host.dataset.xinyaAlertRoot = "true";
  document.body.appendChild(host);
  const root = createRoot(host);

  const close = () => {
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };

  root.render(<AlertModal status={status} message={message} onClose={close} />);

  if (status === "loading") {
    window.setTimeout(() => {
      if (host.isConnected) {
        close();
      }
    }, 60000);
    return;
  }

  window.setTimeout(() => {
    if (host.isConnected) {
      close();
    }
  }, 3000);
}

const overlayStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "18vh",
  background: "transparent",
  pointerEvents: "none" as const,
};

const boxStyle = {
  minWidth: "280px",
  maxWidth: "min(92vw, 420px)",
  padding: "20px",
  borderRadius: "10px",
  background: "#fff",
  color: "#333",
  boxShadow: "0 0 15px rgba(0,0,0,0.2)",
  textAlign: "center" as const,
  fontFamily: "sans-serif",
  pointerEvents: "auto" as const,
};

const iconWrapStyle = {
  display: "grid",
  placeItems: "center" as const,
  marginBottom: "10px",
};

const spinnerStyle = {
  width: "56px",
  height: "56px",
  borderRadius: "50%",
  border: "6px solid rgba(25,118,210,0.18)",
  animation: "xinya-alert-spin 1s linear infinite",
};

const emojiStyle = {
  fontSize: "56px",
  lineHeight: 1,
  fontWeight: 900,
};

const messageStyle = {
  margin: "10px 0",
  fontSize: "16px",
};

const buttonStyle = {
  padding: "6px 16px",
  color: "#fff",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "14px",
  marginTop: "5px",
};

if (typeof document !== "undefined" && !document.getElementById("xinya-alert-react-style")) {
  const style = document.createElement("style");
  style.id = "xinya-alert-react-style";
  style.textContent = `
    @keyframes xinya-alert-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
