import { Fragment } from "react";

import { useFsActions, useFsState } from "../context";
import {
  breadcrumbLinkStyle,
  breadcrumbSeparatorStyle,
  breadcrumbStyle,
  iconButtonStyle,
  searchBoxStyle,
  searchInputStyle,
  topBarStyle,
} from "../styles";

export function TopBar() {
  const { currentPath, viewMode, treeCollapsed, searchInput, searching } = useFsState();
  const actions = useFsActions();

  const segments = currentPath.split("/").filter(Boolean);
  const crumbs = [
    { label: "根目录", path: "/" },
    ...segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join("/")}`,
    })),
  ];

  return (
    <div style={topBarStyle}>
      <button
        type="button"
        style={iconButtonStyle(!treeCollapsed)}
        title={treeCollapsed ? "展开目录树" : "收起目录树"}
        onClick={actions.toggleTree}
      >
        <i className="fa-solid fa-bars" />
      </button>

      <div style={breadcrumbStyle}>
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          return (
            <Fragment key={crumb.path}>
              {index > 0 ? <i className="fa-solid fa-chevron-right" style={breadcrumbSeparatorStyle} /> : null}
              <button
                type="button"
                style={breadcrumbLinkStyle(isCurrent)}
                disabled={isCurrent}
                onClick={() => actions.openDirectory(crumb.path)}
                title={crumb.path}
              >
                {index === 0 ? (
                  <>
                    <i className="fa-solid fa-house" style={{ marginRight: 4 }} />
                    {crumb.label}
                  </>
                ) : (
                  crumb.label
                )}
              </button>
            </Fragment>
          );
        })}
      </div>

      <div style={searchBoxStyle}>
        <i
          className={searching ? "fa-solid fa-circle-notch fa-spin" : "fa-solid fa-magnifying-glass"}
          style={{ color: "var(--x-color-ink-muted)", fontSize: 12 }}
        />
        <input
          style={searchInputStyle}
          value={searchInput}
          placeholder="搜索全部文件…"
          onChange={(event) => actions.setSearchInput(event.target.value)}
        />
        {searchInput ? (
          <button
            type="button"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--x-color-ink-muted)" }}
            title="清除搜索"
            onClick={() => actions.setSearchInput("")}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        style={iconButtonStyle(viewMode === "list")}
        title="列表视图"
        onClick={() => actions.setViewMode("list")}
      >
        <i className="fa-solid fa-list" />
      </button>
      <button
        type="button"
        style={iconButtonStyle(viewMode === "grid")}
        title="网格视图"
        onClick={() => actions.setViewMode("grid")}
      >
        <i className="fa-solid fa-table-cells-large" />
      </button>
    </div>
  );
}
