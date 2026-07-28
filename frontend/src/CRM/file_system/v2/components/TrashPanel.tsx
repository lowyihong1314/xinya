import { useFsActions, useFsState } from "../context";
import {
  dangerButtonStyle,
  emptyStateStyle,
  iconButtonStyle,
  softButtonStyle,
  toolbarStyle,
  trashPanelStyle,
  trashRowStyle,
} from "../styles";
import { formatBytes, formatDateTime } from "../utils";

export function TrashPanel() {
  const { trashOpen, trash } = useFsState();
  const actions = useFsActions();

  if (!trashOpen) return null;

  return (
    <section style={trashPanelStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={iconButtonStyle()} title="返回" onClick={() => actions.setTrashOpen(false)}>
          <i className="fa-solid fa-arrow-left" />
        </button>
        <span style={{ fontSize: 15, fontWeight: 700 }}>回收站</span>
        <span style={{ fontSize: 12.5, color: "var(--x-color-ink-muted)" }}>{trash.length} 项</span>
        <span style={{ flex: 1 }} />
        {trash.length ? (
          <button type="button" style={dangerButtonStyle} onClick={actions.purgeAllTrashItems}>
            <i className="fa-solid fa-broom" /> 清空回收站
          </button>
        ) : null}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {trash.length ? (
          trash.map((entry) => {
            const name = entry.path.replace(/\/+$/, "").split("/").pop() || entry.path;
            return (
              <div key={entry.id} style={trashRowStyle}>
                <i className="fa-solid fa-file-circle-xmark" style={{ color: "var(--x-color-ink-muted)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--x-color-ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    原路径 {entry.path} · {formatBytes(entry.size)} · 删除于 {formatDateTime(entry.deleted_at)}
                  </div>
                </div>
                <button type="button" style={softButtonStyle} onClick={() => actions.restoreTrashItem(entry.id)}>
                  <i className="fa-solid fa-rotate-left" /> 恢复
                </button>
                <button type="button" style={dangerButtonStyle} onClick={() => actions.purgeTrashItem(entry.id, name)}>
                  <i className="fa-solid fa-trash-can" /> 永久删除
                </button>
              </div>
            );
          })
        ) : (
          <div style={emptyStateStyle}>
            <i className="fa-regular fa-trash-can" style={{ fontSize: 36 }} />
            <span>回收站是空的</span>
          </div>
        )}
      </div>
    </section>
  );
}
