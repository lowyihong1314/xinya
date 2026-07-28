import { useMemo, useState } from "react";

import { useFsActions, useFsState } from "../../context";
import { moveTreeContainerStyle, treeNodeStyle } from "../../styles";
import type { DirTreeNode, SelectableItem } from "../../types";
import { buildDirTree, isDescendantPath, parentPathOf } from "../../utils";
import { DialogShell } from "./DialogShell";

export function MoveDialog({ items }: { items: SelectableItem[] }) {
  const { tree } = useFsState();
  const actions = useFsActions();
  const [target, setTarget] = useState<string | null>(null);

  const nodes = useMemo(() => buildDirTree(tree.directories), [tree.directories]);
  // 不能移动到自身或自己的子孙目录；移回原目录也没有意义
  const disabledPaths = items.filter((item) => item.type === "dir").map((item) => item.path);
  const sourceParents = new Set(items.map((item) => parentPathOf(item.path)));

  function isDisabled(path: string) {
    if (disabledPaths.some((dirPath) => isDescendantPath(dirPath, path))) return true;
    return sourceParents.size === 1 && sourceParents.has(path);
  }

  return (
    <DialogShell
      title={items.length > 1 ? `移动 ${items.length} 项到…` : `移动「${items[0]?.name}」到…`}
      onClose={actions.closeDialog}
      onConfirm={() => {
        if (target !== null) void actions.submitMove(items, target);
      }}
      confirmText="移动到此处"
      confirmDisabled={target === null}
    >
      <div style={moveTreeContainerStyle}>
        <PickNode
          label="根目录"
          icon="fa-solid fa-house"
          path="/"
          depth={0}
          target={target}
          disabled={isDisabled("/")}
          onPick={setTarget}
        />
        {nodes.map((node) => (
          <PickTree key={node.path} node={node} depth={0} target={target} isDisabled={isDisabled} onPick={setTarget} />
        ))}
      </div>
    </DialogShell>
  );
}

function PickTree({
  node,
  depth,
  target,
  isDisabled,
  onPick,
}: {
  node: DirTreeNode;
  depth: number;
  target: string | null;
  isDisabled: (path: string) => boolean;
  onPick: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  return (
    <div>
      <PickNode
        label={node.name}
        icon="fa-solid fa-folder"
        path={node.path}
        depth={depth + 1}
        target={target}
        disabled={isDisabled(node.path)}
        onPick={onPick}
        hasChildren={node.children.length > 0}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
      />
      {expanded
        ? node.children.map((child) => (
            <PickTree key={child.path} node={child} depth={depth + 1} target={target} isDisabled={isDisabled} onPick={onPick} />
          ))
        : null}
    </div>
  );
}

function PickNode({
  label,
  icon,
  path,
  depth,
  target,
  disabled,
  onPick,
  hasChildren = false,
  expanded = false,
  onToggle,
}: {
  label: string;
  icon: string;
  path: string;
  depth: number;
  target: string | null;
  disabled: boolean;
  onPick: (path: string) => void;
  hasChildren?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      style={{
        ...treeNodeStyle(target === path, depth, false),
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onClick={() => {
        if (!disabled) onPick(path);
      }}
      title={path}
    >
      {hasChildren ? (
        <button
          type="button"
          style={{ border: "none", background: "transparent", width: 18, cursor: "pointer", color: "var(--x-color-ink-muted)", fontSize: 11 }}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          aria-label={expanded ? "收起" : "展开"}
        >
          <i className={`fa-solid fa-chevron-${expanded ? "down" : "right"}`} />
        </button>
      ) : (
        <span style={{ width: 18, flexShrink: 0 }} />
      )}
      <i className={icon} style={{ color: "var(--x-color-warning)", fontSize: 13 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </div>
  );
}
