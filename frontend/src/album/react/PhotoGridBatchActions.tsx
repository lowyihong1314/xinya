import type { CSSProperties } from "react";

type Props = {
  isMobile?: boolean;
  selectionMode: boolean;
  selectedCount: number;
  pageSelected: boolean;
  allSelected: boolean;
  busy: boolean;
  onToggleMode: () => void;
  onTogglePage: () => void;
  onToggleAll: () => void;
  onClear: () => void;
  onDownloadOriginal: () => void;
  onDownloadJpeg: () => void;
  canDelete?: boolean;
  onDelete: () => void;
};

export function PhotoGridBatchActions({
  isMobile = false,
  selectionMode,
  selectedCount,
  pageSelected,
  allSelected,
  busy,
  onToggleMode,
  onTogglePage,
  onToggleAll,
  onClear,
  onDownloadOriginal,
  onDownloadJpeg,
  canDelete = false,
  onDelete,
}: Props) {
  return (
    <div style={wrapStyle(isMobile)}>
      <div style={metaStyle}>
        <span style={eyebrowStyle}>Batch Tools</span>
        <span>{selectedCount ? `已选择 ${selectedCount} 张` : "未选择图片"}</span>
      </div>
      <div style={actionsStyle(isMobile)}>
        <button type="button" style={buttonStyle(selectionMode)} onClick={onToggleMode}>
          {selectionMode ? "退出多选" : "多选模式"}
        </button>
        {selectionMode ? (
          <>
            <button type="button" style={buttonStyle(false)} onClick={onTogglePage}>
              {pageSelected ? "取消本页" : "全选本页"}
            </button>
            <button type="button" style={buttonStyle(false)} onClick={onToggleAll}>
              {allSelected ? "取消全部" : "跨页全选"}
            </button>
            <button type="button" style={buttonStyle(false)} disabled={!selectedCount || busy} onClick={onClear}>
              清空选择
            </button>
            <button type="button" style={buttonStyle(false)} disabled={!selectedCount || busy} onClick={onDownloadOriginal}>
              {busy ? "处理中…" : "下载原图"}
            </button>
            <button type="button" style={buttonStyle(false)} disabled={!selectedCount || busy} onClick={onDownloadJpeg}>
              {busy ? "处理中…" : "下载 JPEG"}
            </button>
            {canDelete ? (
              <button type="button" style={dangerButtonStyle} disabled={!selectedCount || busy} onClick={onDelete}>
                {busy ? "处理中…" : "移除所选"}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function wrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: isMobile ? "stretch" : "center",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    padding: "14px 16px",
    borderRadius: "16px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
  };
}

const metaStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink)",
};

function actionsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    width: isMobile ? "100%" : undefined,
  };
}

function buttonStyle(active: boolean): CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: "999px",
    border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)",
    background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel-strong)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    cursor: "pointer",
  };
}

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle(false),
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};
