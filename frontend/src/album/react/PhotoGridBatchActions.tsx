import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

type Props = {
  isMobile?: boolean;
  selectionMode: boolean;
  selectedCount: number;
  busy: boolean;
  onExit: () => void;
  onDownloadJpeg: () => void;
  canDelete?: boolean;
  onDelete: () => void;
};

export function PhotoGridBatchActions({
  isMobile = false,
  selectionMode,
  selectedCount,
  busy,
  onExit,
  onDownloadJpeg,
  canDelete = false,
  onDelete,
}: Props) {
  if (!selectionMode) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <style>{selectionControlsStyle}</style>
      <div id="event-detail-photo-grid-selection-controls" style={wrapStyle(isMobile)}>
        <div id="event-detail-photo-grid-selection-control-buttons" style={actionsStyle(isMobile)}>
          <button
            id="event-detail-photo-grid-selection-exit"
            type="button"
            aria-label="退出多选"
            title="退出多选"
            style={iconButtonStyle(false)}
            onClick={onExit}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" style={iconStyle} />
            <span id="event-detail-photo-grid-selection-count" style={selectionCountBadgeStyle}>
              {selectedCount}
            </span>
          </button>
          <button
            id="event-detail-photo-grid-selection-download-jpeg"
            type="button"
            aria-label="下载 JPEG"
            title="下载 JPEG"
            style={iconButtonStyle(!selectedCount || busy)}
            disabled={!selectedCount || busy}
            onClick={onDownloadJpeg}
          >
            <i className={busy ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-file-image"} aria-hidden="true" style={iconStyle} />
          </button>
          {canDelete ? (
            <button
              id="event-detail-photo-grid-selection-delete"
              type="button"
              aria-label="移除所选"
              title="移除所选"
              style={dangerIconButtonStyle(!selectedCount || busy)}
              disabled={!selectedCount || busy}
              onClick={onDelete}
            >
              <i className={busy ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-trash-can"} aria-hidden="true" style={iconStyle} />
            </button>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

function wrapStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    left: "50%",
    bottom: isMobile ? "max(16px, env(safe-area-inset-bottom))" : "22px",
    zIndex: 2600,
    transform: "translateX(-50%)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: isMobile ? "8px 12px" : "10px 14px",
    borderRadius: 0,
    background: "transparent",
    border: "none",
    boxShadow: "none",
    backdropFilter: "none",
    pointerEvents: "none",
  };
}

function actionsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: isMobile ? "18px" : "22px",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "auto",
  };
}

function iconButtonStyle(disabled: boolean): CSSProperties {
  return {
    position: "relative",
    width: "42px",
    height: "42px",
    padding: 0,
    borderRadius: "999px",
    border: "1px solid rgba(56,189,248,0.24)",
    background: disabled ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.66)",
    color: disabled ? "rgba(70,120,158,0.34)" : "rgba(31,78,121,0.92)",
    display: "grid",
    placeItems: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 10px 24px rgba(14,116,144,0.12)",
    backdropFilter: "blur(14px) saturate(130%)",
    transition: "transform 170ms ease, color 170ms ease, text-shadow 170ms ease, background 170ms ease, border-color 170ms ease",
  };
}

function dangerIconButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...iconButtonStyle(disabled),
    color: disabled ? "rgba(70,120,158,0.34)" : "rgba(190,18,60,0.86)",
  };
}

const iconStyle: CSSProperties = {
  fontSize: "19px",
  lineHeight: 1,
  pointerEvents: "none",
};

const selectionCountBadgeStyle: CSSProperties = {
  position: "absolute",
  left: "-7px",
  top: "-7px",
  minWidth: "20px",
  height: "20px",
  padding: "0 6px",
  borderRadius: "999px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(255,255,255,0.82)",
  background: "rgba(14,165,233,0.94)",
  color: "rgba(255,255,255,0.98)",
  boxShadow: "0 8px 18px rgba(14,116,144,0.2)",
  fontSize: "11px",
  fontWeight: 800,
  lineHeight: 1,
  pointerEvents: "none",
};

const selectionControlsStyle = `
#event-detail-photo-grid-selection-control-buttons button:not(:disabled):hover {
  transform: translateY(-3px) scale(1.14);
  background: rgba(255,255,255,0.84) !important;
  border-color: rgba(56,189,248,0.44) !important;
  color: rgba(3,105,161,0.98) !important;
  text-shadow: none;
}

#event-detail-photo-grid-selection-delete:not(:disabled):hover {
  background: rgba(255,241,242,0.92) !important;
  border-color: rgba(244,63,94,0.32) !important;
  color: rgba(190,18,60,0.88) !important;
  text-shadow: none;
}

#event-detail-photo-grid-selection-control-buttons button:focus-visible {
  outline: 2px solid rgba(56,189,248,0.7);
  outline-offset: 3px;
}
`;
