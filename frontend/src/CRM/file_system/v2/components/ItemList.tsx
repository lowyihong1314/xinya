import { useFsActions, useFsState } from "../context";
import {
  emptyStateStyle,
  itemIconStyle,
  listHeaderCellStyle,
  listHeaderStyle,
  listMetaCellStyle,
  listNameCellStyle,
  listRowStyle,
} from "../styles";
import type { SelectableItem, SortKey } from "../types";
import { fileIcon, formatBytes, formatDateTime } from "../utils";
import { useItemHandlers } from "./useItemHandlers";

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "名称" },
  { key: "size", label: "大小" },
  { key: "updated_at", label: "修改时间" },
  { key: "owner", label: "所有者" },
];

export function ItemList() {
  const { visibleItems, sort } = useFsState();
  const actions = useFsActions();

  if (!visibleItems.length) {
    return (
      <div style={emptyStateStyle}>
        <i className="fa-regular fa-folder-open" style={{ fontSize: 36 }} />
        <span>此目录为空，拖入文件即可上传</span>
      </div>
    );
  }

  return (
    <div>
      <div style={listHeaderStyle}>
        {COLUMNS.map((column) => (
          <button key={column.key} type="button" style={listHeaderCellStyle(true)} onClick={() => actions.setSort(column.key)}>
            {column.label}
            {sort.key === column.key ? (
              <i className={`fa-solid fa-caret-${sort.dir === "asc" ? "up" : "down"}`} />
            ) : null}
          </button>
        ))}
        <span />
      </div>
      {visibleItems.map((item) => (
        <ListRow key={item.path} item={item} />
      ))}
    </div>
  );
}

function ListRow({ item }: { item: SelectableItem }) {
  const actions = useFsActions();
  const { handlers, selected, dropTarget } = useItemHandlers(item);
  const isDir = item.type === "dir";

  return (
    <div style={listRowStyle(selected, dropTarget)} {...handlers}>
      <div style={listNameCellStyle}>
        <i className={fileIcon(item)} style={itemIconStyle(isDir)} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontWeight: isDir ? 600 : 500 }}>{item.name}</span>
      </div>
      <span style={listMetaCellStyle}>{isDir ? "—" : formatBytes(("size" in item && item.size) || 0)}</span>
      <span style={listMetaCellStyle}>{isDir ? "—" : formatDateTime("updated_at" in item ? item.updated_at : null)}</span>
      <span style={listMetaCellStyle}>{("owner" in item && item.owner) || "—"}</span>
      <button
        type="button"
        style={{
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
