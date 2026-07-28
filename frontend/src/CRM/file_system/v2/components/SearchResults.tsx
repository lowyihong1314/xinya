import { useFsActions, useFsState } from "../context";
import { emptyStateStyle, itemIconStyle, listMetaCellStyle, listRowStyle, searchResultPathStyle, softButtonStyle } from "../styles";
import type { FileRow } from "../types";
import { fileIcon, formatBytes, formatDateTime, parentPathOf } from "../utils";

export function SearchResults() {
  const { searchResult, searching } = useFsState();
  const actions = useFsActions();

  if (!searchResult) return null;

  if (!searchResult.items.length) {
    return (
      <div style={emptyStateStyle}>
        <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 32 }} />
        <span>{searching ? "搜索中…" : `没有找到与「${searchResult.query}」匹配的文件`}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: "10px 16px", fontSize: 12.5, color: "var(--x-color-ink-muted)" }}>
        找到 {searchResult.items.length} 项{searchResult.truncated ? "（结果过多，仅显示前一部分）" : ""}
      </div>
      {searchResult.items.map((item) => (
        <SearchRow key={`${item.type}-${item.path}`} item={item} />
      ))}
    </div>
  );
}

function SearchRow({ item }: { item: FileRow }) {
  const actions = useFsActions();
  const isDir = item.type === "dir";
  const parent = parentPathOf(item.path);

  return (
    <div
      style={{ ...listRowStyle(false, false), gridTemplateColumns: "minmax(200px, 1fr) 110px 150px 120px" }}
      onDoubleClick={() => actions.activate(item)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
        <i className={fileIcon(item)} style={itemIconStyle(isDir)} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
          <div style={searchResultPathStyle}>{item.path}</div>
        </div>
      </div>
      <span style={listMetaCellStyle}>{isDir ? "—" : formatBytes(item.size || 0)}</span>
      <span style={listMetaCellStyle}>{formatDateTime(item.updated_at)}</span>
      <button
        type="button"
        style={{ ...softButtonStyle, padding: "4px 10px", fontSize: 12 }}
        onClick={() => actions.openDirectory(isDir ? item.path : parent)}
      >
        <i className="fa-solid fa-folder-open" /> {isDir ? "打开" : "所在目录"}
      </button>
    </div>
  );
}
