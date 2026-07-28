import { useEffect, type ReactNode } from "react";

import { dialogCardStyle, dialogFooterStyle, dialogOverlayStyle, dialogTitleStyle, primaryButtonStyle, softButtonStyle } from "../../styles";

export function DialogShell({
  title,
  children,
  onClose,
  onConfirm,
  confirmText = "确定",
  confirmDisabled = false,
  hideFooter = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  confirmDisabled?: boolean;
  hideFooter?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={dialogOverlayStyle} onClick={onClose}>
      <div style={dialogCardStyle} onClick={(event) => event.stopPropagation()}>
        <h3 style={dialogTitleStyle}>{title}</h3>
        {children}
        {hideFooter ? null : (
          <div style={dialogFooterStyle}>
            <button type="button" style={softButtonStyle} onClick={onClose}>
              取消
            </button>
            {onConfirm ? (
              <button
                type="button"
                style={{ ...primaryButtonStyle, opacity: confirmDisabled ? 0.5 : 1 }}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmText}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
