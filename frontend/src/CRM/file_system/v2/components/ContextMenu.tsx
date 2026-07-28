import { useEffect } from "react";

import { useFsActions, useFsState } from "../context";
import { contextMenuDividerStyle, contextMenuItemStyle, contextMenuStyle } from "../styles";
import { isPreviewable } from "../utils";

export function ContextMenu() {
  const { contextMenu, selectedItems } = useFsState();
  const actions = useFsActions();

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => actions.setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu, actions]);

  if (!contextMenu) return null;
  const { item } = contextMenu;
  const isDir = item.type === "dir";
  const multi = selectedItems.length > 1;
  const targets = multi ? selectedItems : [item];

  // 菜单靠近视口边缘时往回收
  const x = Math.min(contextMenu.x, window.innerWidth - 200);
  const y = Math.min(contextMenu.y, window.innerHeight - 320);

  function run(action: () => void) {
    actions.setContextMenu(null);
    action();
  }

  return (
    <div style={contextMenuStyle(x, y)} onClick={(event) => event.stopPropagation()}>
      {isDir ? (
        <MenuItem icon="fa-solid fa-folder-open" label="打开" onClick={() => run(() => actions.activate(item))} />
      ) : (
        <>
          {isPreviewable(item.name) ? (
            <MenuItem icon="fa-solid fa-eye" label="预览" onClick={() => run(() => actions.setPreviewItem(item))} />
          ) : null}
          <MenuItem icon="fa-solid fa-download" label="下载" onClick={() => run(() => actions.downloadItem(item))} />
        </>
      )}
      <MenuItem icon="fa-solid fa-circle-info" label="详情" onClick={() => run(() => actions.openDrawerFor(item))} />
      <div style={contextMenuDividerStyle} />
      {!multi ? (
        <MenuItem icon="fa-solid fa-pen" label="重命名" onClick={() => run(() => actions.openDialog({ kind: "rename", item }))} />
      ) : null}
      <MenuItem
        icon="fa-solid fa-arrows-up-down-left-right"
        label={multi ? `移动 ${targets.length} 项` : "移动"}
        onClick={() => run(() => actions.openDialog({ kind: "move", items: targets }))}
      />
      {!isDir && !multi ? (
        <MenuItem icon="fa-solid fa-share-nodes" label="分享" onClick={() => run(() => actions.openDialog({ kind: "share", item }))} />
      ) : null}
      {isDir && !multi ? (
        <MenuItem
          icon="fa-solid fa-user-shield"
          label="目录权限"
          onClick={() => run(() => actions.openDialog({ kind: "dirPermission", dir: item }))}
        />
      ) : null}
      <div style={contextMenuDividerStyle} />
      <MenuItem
        icon="fa-solid fa-trash-can"
        label={multi ? `删除 ${targets.length} 项` : "删除"}
        danger
        onClick={() => run(() => actions.deleteItems(targets))}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      style={contextMenuItemStyle(danger)}
      onClick={onClick}
      onMouseEnter={(event) => {
        (event.currentTarget as HTMLButtonElement).style.background = "var(--x-color-panel-alt)";
      }}
      onMouseLeave={(event) => {
        (event.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <i className={icon} style={{ width: 16, textAlign: "center" }} />
      {label}
    </button>
  );
}
