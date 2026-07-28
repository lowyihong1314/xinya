import { useMemo, useState, type DragEvent } from "react";

import { useFsActions, useFsState } from "../context";
import { treeNodeStyle, treeSidebarStyle, treeToggleStyle } from "../styles";
import type { DirTreeNode } from "../types";
import { buildDirTree, isDescendantPath } from "../utils";
import { readDraggedPaths } from "./dragPayload";

export function TreeSidebar() {
  const { tree, treeCollapsed, currentPath } = useFsState();
  const nodes = useMemo(() => buildDirTree(tree.directories), [tree.directories]);

  return (
    <aside style={treeSidebarStyle(treeCollapsed)}>
      {treeCollapsed ? null : (
        <>
          <RootNode />
          {nodes.map((node) => (
            <TreeNode key={node.path} node={node} depth={0} currentPath={currentPath} />
          ))}
        </>
      )}
    </aside>
  );
}

function RootNode() {
  const { currentPath } = useFsState();
  const actions = useFsActions();
  const [dropTarget, setDropTarget] = useState(false);

  return (
    <button
      type="button"
      style={treeNodeStyle(currentPath === "/", 0, dropTarget)}
      onClick={() => actions.openDirectory("/")}
      onDragOver={(event) => {
        event.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropTarget(false);
        const paths = readDraggedPaths(event);
        if (paths.length) actions.moveItemsTo(paths, "/");
      }}
    >
      <i className="fa-solid fa-house" style={{ fontSize: 12 }} />
      根目录
    </button>
  );
}

function TreeNode({ node, depth, currentPath }: { node: DirTreeNode; depth: number; currentPath: string }) {
  const actions = useFsActions();
  const [expanded, setExpanded] = useState(() => isDescendantPath(node.path, currentPath));
  const [dropTarget, setDropTarget] = useState(false);
  const active = currentPath === node.path;
  const hasChildren = node.children.length > 0;

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(false);
    const paths = readDraggedPaths(event);
    if (paths.length) actions.moveItemsTo(paths, node.path);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        style={treeNodeStyle(active, depth, dropTarget)}
        onClick={() => actions.openDirectory(node.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter") actions.openDirectory(node.path);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={handleDrop}
        title={node.path}
      >
        {hasChildren ? (
          <button
            type="button"
            style={treeToggleStyle}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((prev) => !prev);
            }}
            aria-label={expanded ? "收起" : "展开"}
          >
            <i className={`fa-solid fa-chevron-${expanded ? "down" : "right"}`} />
          </button>
        ) : (
          <span style={{ width: 18, flexShrink: 0 }} />
        )}
        <i
          className={expanded && hasChildren ? "fa-solid fa-folder-open" : "fa-solid fa-folder"}
          style={{ color: "var(--x-color-warning)", fontSize: 13 }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
      </div>
      {expanded
        ? node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} currentPath={currentPath} />
          ))
        : null}
    </div>
  );
}
