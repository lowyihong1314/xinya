import { useState, type DragEvent, type MouseEvent } from "react";

import { useFsActions, useFsState } from "../context";
import type { SelectableItem } from "../types";
import { isExternalFileDrag, readDraggedPaths, writeDraggedPaths } from "./dragPayload";

// 列表行与网格卡片共用的交互：选择 / 双击 / 右键菜单 / 拖拽
export function useItemHandlers(item: SelectableItem) {
  const { selection, isMobile } = useFsState();
  const actions = useFsActions();
  const [dropTarget, setDropTarget] = useState(false);
  const selected = selection.has(item.path);

  const handlers = {
    onClick: (event: MouseEvent) => {
      actions.setContextMenu(null);
      actions.select(item, {
        additive: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      });
    },
    onDoubleClick: () => actions.activate(item),
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      if (!selected) actions.select(item);
      actions.setContextMenu({ x: event.clientX, y: event.clientY, item });
    },
    draggable: !isMobile,
    onDragStart: (event: DragEvent) => {
      const paths = selected && selection.size > 1 ? Array.from(selection) : [item.path];
      writeDraggedPaths(event, paths);
    },
    onDragOver:
      item.type === "dir"
        ? (event: DragEvent) => {
            if (isExternalFileDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(true);
          }
        : undefined,
    onDragLeave: item.type === "dir" ? () => setDropTarget(false) : undefined,
    onDrop:
      item.type === "dir"
        ? (event: DragEvent) => {
            if (isExternalFileDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(false);
            const paths = readDraggedPaths(event);
            if (paths.length) actions.moveItemsTo(paths, item.path);
          }
        : undefined,
  };

  return { handlers, selected, dropTarget };
}
