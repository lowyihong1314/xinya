import type { CSSProperties } from "react";

import { openOverlay } from "../app/OverlayProvider";
import { ensureDesignTokens } from "../theme/designTokens";

type AlertStatus = "success" | "error" | "loading";

const TONES: Record<AlertStatus, { fg: string; bg: string }> = {
  success: {
    fg: "var(--x-color-success, #059669)",
    bg: "var(--x-color-success-soft, rgba(5, 150, 105, 0.12))",
  },
  error: {
    fg: "var(--x-color-danger, #be123c)",
    bg: "var(--x-color-danger-soft, rgba(190, 18, 60, 0.1))",
  },
  loading: {
    fg: "var(--x-color-accent-strong, #0f766e)",
    bg: "var(--x-color-accent-soft, rgba(15, 118, 110, 0.12))",
  },
};

function AlertToast({
  status,
  message,
  onClose,
}: {
  status: AlertStatus;
  message: string;
  onClose: () => void;
}) {
  const tone = TONES[status];

  return (
    <>
      <style>{`
        @keyframes xinya-toast-in {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes xinya-toast-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={overlayStyle}>
        <div
          style={toastStyle}
          role={status === "error" ? "alert" : "status"}
          onClick={status === "loading" ? undefined : onClose}
        >
          <span style={{ ...iconBadgeStyle, background: tone.bg, color: tone.fg }}>
            {status === "loading" ? (
              <span style={{ ...spinnerStyle, borderTopColor: tone.fg }} />
            ) : status === "success" ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span style={messageStyle}>{message}</span>
        </div>
      </div>
    </>
  );
}

export function show_alert(status: AlertStatus, message: string) {
  ensureDesignTokens();
  const close = openOverlay(
    (dismiss) => <AlertToast status={status} message={message} onClose={dismiss} />,
    { key: "xinya-alert" },
  );

  // loading 最长挂 60s 兜底；成功/失败按内容长短停留后自动消失（点一下也能关）。
  const duration = status === "loading" ? 60000 : Math.min(6500, Math.max(2600, message.length * 90));
  window.setTimeout(() => {
    close();
  }, duration);
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "max(20px, env(safe-area-inset-top))",
  background: "transparent",
  pointerEvents: "none",
};

const toastStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  maxWidth: "min(92vw, 480px)",
  padding: "10px 16px 10px 10px",
  borderRadius: "999px",
  background: "var(--x-color-panel, #ffffff)",
  color: "var(--x-color-ink, #1d2433)",
  border: "1px solid var(--x-color-line-soft, rgba(29, 36, 51, 0.08))",
  boxShadow: "0 12px 32px var(--x-color-shadow, rgba(15, 23, 42, 0.16)), 0 2px 8px rgba(15, 23, 42, 0.08)",
  fontFamily: "var(--x-font-sans, sans-serif)",
  pointerEvents: "auto",
  cursor: "pointer",
  animation: "xinya-toast-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2)",
};

const iconBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  borderRadius: "50%",
  flexShrink: 0,
};

const spinnerStyle: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: "50%",
  border: "2.4px solid transparent",
  animation: "xinya-toast-spin 0.8s linear infinite",
  boxSizing: "border-box",
};

const messageStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  minWidth: 0,
};
