import { useFsActions, useFsState } from "../context";
import { emptyStateStyle, gridCardStyle, gridContainerStyle, gridIconStyle, gridMetaStyle, gridNameStyle } from "../styles";
import type { SelectableItem } from "../types";
import { fileIcon, formatBytes } from "../utils";
import { useItemHandlers } from "./useItemHandlers";

export function ItemGrid() {
  const { visibleItems } = useFsState();

  if (!visibleItems.length) {
    return (
      <div style={emptyStateStyle}>
        <i className="fa-regular fa-folder-open" style={{ fontSize: 36 }} />
        <span>此目录为空，拖入文件即可上传</span>
      </div>
    );
  }

  return (
    <div style={gridContainerStyle}>
      {visibleItems.map((item) => (
        <GridCard key={item.path} item={item} />
      ))}
    </div>
  );
}

function GridCard({ item }: { item: SelectableItem }) {
  const actions = useFsActions();
  const { handlers, selected, dropTarget } = useItemHandlers(item);
  const isDir = item.type === "dir";

  return (
    <div style={gridCardStyle(selected, dropTarget)} {...handlers} title={item.name}>
      <i className={fileIcon(item)} style={gridIconStyle(isDir)} />
      <span style={gridNameStyle}>{item.name}</span>
      <span style={gridMetaStyle}>{isDir ? "文件夹" : formatBytes(("size" in item && item.size) || 0)}</span>
      <button
        type="button"
        style={{
          position: "absolute",
          alignSelf: "flex-end",
          border: "none",
          background: "transparent",
          color: "var(--x-color-ink-muted)",
          cursor: "pointer",
          padding: 4,
        }}
        title="更多操作"
        onClick={(event) => {
          event.stopPropagation();
          if (!selected) actions.select(item);
          actions.setContextMenu({ x: event.clientX, y: event.clientY, item });
        }}
      >
        <i className="fa-solid fa-ellipsis-vertical" />
      </button>
    </div>
  );
}
