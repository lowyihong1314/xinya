import { openOverlay } from "../app/OverlayProvider";

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
    success: "rgba(5,150,105,0.92)",
    error: "rgba(190,18,60,0.86)",
    loading: "rgba(14,165,233,0.96)",
  } as const;

  return (
    <>
      <style>{`
        @keyframes xinya-alert-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div style={overlayStyle}>
        <div style={{ ...boxStyle, borderColor: status === "error" ? "rgba(244,63,94,0.24)" : "rgba(56,189,248,0.24)" }}>
          <div style={iconWrapStyle}>
            {status === "loading" ? <div style={{ ...spinnerStyle, borderTopColor: colors.loading }} /> : null}
            {status === "success" ? <div style={{ ...emojiStyle, color: colors.success }}>✓</div> : null}
            {status === "error" ? <div style={{ ...emojiStyle, color: colors.error }}>✕</div> : null}
          </div>

          <div style={messageStyle}>{message}</div>

          {status !== "loading" ? (
            <button type="button" style={{ ...buttonStyle, borderColor: colors[status], color: colors[status] }} onClick={onClose}>
              OK
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function show_alert(status: AlertStatus, message: string) {
  const close = openOverlay(
    (dismiss) => <AlertModal status={status} message={message} onClose={dismiss} />,
    { key: "xinya-alert" },
  );

  if (status === "loading") {
    window.setTimeout(() => {
      close();
    }, 60000);
    return;
  }

  window.setTimeout(() => {
    close();
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
  borderRadius: 0,
  background: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(232,247,255,0.62))",
  color: "rgba(12,74,110,0.96)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 24px 64px rgba(214,242,255,0.52), inset 0 1px 0 rgba(255,255,255,0.1)",
  backdropFilter: "blur(22px) saturate(140%)",
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
  lineHeight: 1.5,
};

const buttonStyle = {
  padding: "6px 16px",
  background: "rgba(255,255,255,0.6)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "999px",
  cursor: "pointer",
  fontSize: "14px",
  marginTop: "5px",
  fontWeight: 800,
  backdropFilter: "blur(14px)",
};
