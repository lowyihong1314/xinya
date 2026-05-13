import type { CSSProperties, DragEvent } from "react";

import type { DepartmentRecord, UserRecord } from "../../user_control/react/types";
import type { FileDetail, PermissionRow, SelectableItem, Toast, TrashRow, TreeResponse } from "./types";
import { formatBytes, itemsPerPage } from "./utils";
import {
  actionBarStyle,
  backdropStyle,
  breadcrumbStyle,
  brandLabelStyle,
  brandPathStyle,
  brandStyle,
  cardIconStyle,
  cardMetaStyle,
  cardNameStyle,
  cardStyle,
  contentStyle,
  crumbButtonStyle,
  dangerButtonStyle,
  detailBlockStyle,
  detailMetaCardStyle,
  detailMetaGridStyle,
  detailMetaLabelStyle,
  detailMetaValueStyle,
  detailNameStyle,
  detailPanelStyle,
  detailPathStyle,
  detailTitleStyle,
  emptyPanelStyle,
  emptyStateStyle,
  ghostButtonStyle,
  gridStyle,
  historyActionStyle,
  historyRowStyle,
  historyTimeStyle,
  listMetaStyle,
  listNameStyle,
  listRowStyle,
  listTableStyle,
  loadingBadgeStyle,
  mainStyle,
  pageButtonStyle,
  paginationStyle,
  permissionMainStyle,
  permissionRowStyle,
  permissionSubStyle,
  primaryButtonStyle,
  searchInputStyle,
  secondaryButtonStyle,
  sectionLabelStyle,
  shellStyle,
  sidebarSectionTitle,
  sidebarStyle,
  tinyDangerButtonStyle,
  toastStyle,
  toolbarRightStyle,
  toolbarStyle,
  trashHeaderStyle,
  trashMetaStyle,
  trashPanelStyle,
  trashPathStyle,
  trashRowStyle,
  trashSubStyle,
  treeButtonStyle,
  treeScrollStyle,
  workspaceStyle,
} from "./styles";

export function FileSystemView(props: {
  embedded?: boolean;
  currentPath: string;
  tree: TreeResponse;
  trash: TrashRow[];
  trashOpen: boolean;
  setTrashOpen: (value: boolean) => void;
  query: string;
  setQuery: (value: string) => void;
  viewMode: "grid" | "list";
  setViewMode: (value: "grid" | "list") => void;
  selectedItem: SelectableItem | null;
  selectedPaths: string[];
  selectedDetail: FileDetail | null;
  selectedPermissions: PermissionRow[];
  pagedItems: SelectableItem[];
  visibleItemCount: number;
  page: number;
  setPage: (value: number) => void;
  loading: boolean;
  toast: Toast | null;
  permissionTargetUsers: UserRecord[];
  permissionTargetDepartments: DepartmentRecord[];
  directoryPermissionDialog: {
    open: boolean;
    dirPath: string;
    dirName: string;
    targetType: "user" | "department";
    targetId: string;
    permission: "read" | "read_write" | "read_public";
  };
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  onOpenDirectory: (path: string) => void;
  onRefresh: () => void;
  onCreateFolder: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onDownloadArchive: () => void;
  onShare: () => void;
  onSetDirectoryPermission: () => void;
  onDirectoryPermissionDialogChange: (
    updater:
      | {
          open: boolean;
          dirPath: string;
          dirName: string;
          targetType: "user" | "department";
          targetId: string;
          permission: "read" | "read_write" | "read_public";
        }
      | ((prev: {
          open: boolean;
          dirPath: string;
          dirName: string;
          targetType: "user" | "department";
          targetId: string;
          permission: "read" | "read_write" | "read_public";
        }) => {
          open: boolean;
          dirPath: string;
          dirName: string;
          targetType: "user" | "department";
          targetId: string;
          permission: "read" | "read_write" | "read_public";
        }),
  ) => void;
  onSubmitDirectoryPermission: () => void;
  onUploadFiles: (files: FileList | null, asFolder: boolean) => void;
  onRestoreTrash: (trashId: number) => void;
  onRemovePermission: (permissionId: number) => void;
  onSelect: (item: SelectableItem, additive: boolean) => void;
  onActivate: (item: SelectableItem) => void;
  onDropOnDirectory: (dirPath: string, event: DragEvent<HTMLDivElement>) => void;
}) {
  const breadcrumbParts =
    props.currentPath === "/" ? [] : props.currentPath.split("/").filter(Boolean);
  const viewPermissions = props.selectedPermissions.filter(
    (permission) => permission.permission === "read" || permission.permission === "read_public",
  );
  const writePermissions = props.selectedPermissions.filter((permission) => permission.permission === "read_write");
  const visibleTreePaths = getVisibleTreePaths(props.tree.directories, props.currentPath);

  return (
    <div style={shellStyle(props.embedded)}>
      <div style={backdropStyle} />
      <aside style={sidebarStyle}>
        <div style={brandStyle}>
          <div style={brandLabelStyle}>Storage Atlas</div>
          <div style={brandPathStyle}>{props.currentPath}</div>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => props.onOpenDirectory("/")}>
          Root
        </button>
        <div style={sidebarSectionTitle}>Directory Tree</div>
        <div style={treeScrollStyle}>
          {visibleTreePaths.map((path) => (
            <button
              key={path}
              type="button"
              style={{
                ...treeButtonStyle(path === props.currentPath),
                marginLeft: `${Math.max(0, getTreeDepth(path, props.currentPath) * 12)}px`,
              }}
              onClick={() => props.onOpenDirectory(path)}
            >
              {renderTreeLabel(path, props.currentPath)}
            </button>
          ))}
        </div>
      </aside>

      <main style={mainStyle}>
        <section style={toolbarStyle}>
          <div style={breadcrumbStyle}>
            <button type="button" style={crumbButtonStyle} onClick={() => props.onOpenDirectory("/")}>
              /
            </button>
            {breadcrumbParts.map((part, index) => {
              const path = "/" + breadcrumbParts.slice(0, index + 1).join("/");
              return (
                <button key={path} type="button" style={crumbButtonStyle} onClick={() => props.onOpenDirectory(path)}>
                  {part}
                </button>
              );
            })}
          </div>
          <div style={toolbarRightStyle}>
            <button type="button" style={secondaryButtonStyle} onClick={props.onRefresh}>
              Refresh
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => props.setTrashOpen(!props.trashOpen)}>
              {props.trashOpen ? "Hide Trash" : `Trash (${props.trash.length})`}
            </button>
            <input
              value={props.query}
              onChange={(event) => props.setQuery(event.target.value)}
              placeholder="Search current directory"
              style={searchInputStyle}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => props.setViewMode(props.viewMode === "grid" ? "list" : "grid")}
            >
              {props.viewMode === "grid" ? "List" : "Grid"}
            </button>
          </div>
        </section>

        <section style={workspaceStyle}>
          <div style={contentStyle}>
            <div style={actionBarStyle}>
              <button type="button" style={primaryButtonStyle} onClick={props.onCreateFolder}>
                New Folder
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={() => props.fileInputRef.current?.click()}>
                Upload Files
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={() => props.folderInputRef.current?.click()}>
                Upload Folder
              </button>
              <button type="button" style={ghostButtonStyle} disabled={!props.selectedItem} onClick={props.onRename}>
                Rename
              </button>
              <button
                type="button"
                style={ghostButtonStyle}
                disabled={!props.selectedItem || props.selectedItem.type !== "file"}
                onClick={props.onMove}
              >
                Move
              </button>
              <button type="button" style={ghostButtonStyle} disabled={!props.selectedPaths.length} onClick={props.onDownloadArchive}>
                Zip
              </button>
              <button
                type="button"
                style={ghostButtonStyle}
                disabled={!props.selectedItem || props.selectedItem.type !== "file"}
                onClick={props.onShare}
              >
                Share
              </button>
              <button type="button" style={dangerButtonStyle} disabled={!props.selectedPaths.length} onClick={props.onDelete}>
                Trash
              </button>
            </div>

            <input
              ref={props.fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(event) => props.onUploadFiles(event.target.files, false)}
            />
            <input
              ref={props.folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              style={{ display: "none" }}
              onChange={(event) => props.onUploadFiles(event.target.files, true)}
            />

            <DirectoryList
              items={props.pagedItems}
              viewMode={props.viewMode}
              selectedPaths={props.selectedPaths}
              onSelect={props.onSelect}
              onActivate={props.onActivate}
              onDropOnDirectory={props.onDropOnDirectory}
            />

            <Pagination total={props.visibleItemCount} page={props.page} onChange={props.setPage} />
          </div>

          <aside style={detailPanelStyle}>
            <div style={detailTitleStyle}>Inspector</div>
            {props.selectedItem ? (
              <>
                <div style={detailNameStyle}>{props.selectedItem.name}</div>
                <div style={detailPathStyle}>{props.selectedItem.path}</div>
                {props.selectedDetail ? (
                  <div style={detailMetaGridStyle}>
                    <DetailMeta label="Type" value={props.selectedDetail.file_type || "folder"} />
                    <DetailMeta label="Updated" value={props.selectedDetail.updated_at || "-"} />
                    <DetailMeta label="Size" value={formatBytes(props.selectedDetail.file_size || 0)} />
                    <DetailMeta label="Owner" value={String(props.selectedDetail.owner_id)} />
                  </div>
                ) : null}
                {props.selectedItem.type === "dir" ? (
                  <button type="button" style={secondaryButtonStyle} onClick={props.onSetDirectoryPermission}>
                    Set Directory Permission
                  </button>
                ) : null}
                {props.selectedPermissions.length > 0 ? (
                  <div style={detailBlockStyle}>
                    <div style={sectionLabelStyle}>Permissions</div>
                    {viewPermissions.length ? (
                      <PermissionGroup
                        title="Can View"
                        permissions={viewPermissions}
                        users={props.permissionTargetUsers}
                        departments={props.permissionTargetDepartments}
                        onRemovePermission={props.onRemovePermission}
                      />
                    ) : (
                      <div style={emptyPanelStyle}>No explicit viewers.</div>
                    )}
                    {writePermissions.length ? (
                      <PermissionGroup
                        title="Can Write"
                        permissions={writePermissions}
                        users={props.permissionTargetUsers}
                        departments={props.permissionTargetDepartments}
                        onRemovePermission={props.onRemovePermission}
                      />
                    ) : (
                      <div style={emptyPanelStyle}>No explicit writers.</div>
                    )}
                  </div>
                ) : props.selectedItem.type === "file" ? (
                  <div style={detailBlockStyle}>
                    <div style={sectionLabelStyle}>Permissions</div>
                    <div style={emptyPanelStyle}>No explicit permissions on this file.</div>
                  </div>
                ) : (
                  <div style={detailBlockStyle}>
                    <div style={sectionLabelStyle}>Permissions</div>
                    <div style={emptyPanelStyle}>Directory permission summary is not loaded here yet. Use Set Directory Permission to manage access.</div>
                  </div>
                )}
                {props.selectedDetail?.history?.length ? (
                  <div style={detailBlockStyle}>
                    <div style={sectionLabelStyle}>Recent History</div>
                    {props.selectedDetail.history.slice(0, 6).map((row) => (
                      <div key={row.id} style={historyRowStyle}>
                        <div style={historyActionStyle}>{row.action}</div>
                        <div style={historyTimeStyle}>{row.timestamp}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div style={emptyPanelStyle}>Select a file or folder to inspect metadata and permissions.</div>
            )}
          </aside>
        </section>

        {props.trashOpen ? (
          <section style={trashPanelStyle}>
            <div style={trashHeaderStyle}>
              <div>
                <div style={sectionLabelStyle}>Trash Recovery</div>
                <div style={trashSubStyle}>恢复会回填文件和目录结构。</div>
              </div>
            </div>
            {props.trash.length ? (
              props.trash.map((item) => (
                <div key={item.id} style={trashRowStyle}>
                  <div>
                    <div style={trashPathStyle}>{item.path}</div>
                    <div style={trashMetaStyle}>
                      {formatBytes(item.size)} · {item.deleted_at || "-"}
                    </div>
                  </div>
                  <button type="button" style={secondaryButtonStyle} onClick={() => props.onRestoreTrash(item.id)}>
                    Restore
                  </button>
                </div>
              ))
            ) : (
              <div style={emptyPanelStyle}>Trash is empty.</div>
            )}
          </section>
        ) : null}
      </main>

      {props.loading ? <div style={loadingBadgeStyle}>Working...</div> : null}
      {props.toast ? <div style={toastStyle(props.toast.tone)}>{props.toast.message}</div> : null}
      {props.directoryPermissionDialog.open ? (
        <div style={dialogOverlayStyle}>
          <div style={dialogPanelStyle}>
            <div style={detailTitleStyle}>Set Directory Permission</div>
            <div style={detailPathStyle}>{props.directoryPermissionDialog.dirPath || props.directoryPermissionDialog.dirName}</div>
            <div style={dialogFieldStyle}>
              <div style={sectionLabelStyle}>Target Type</div>
              <select
                value={props.directoryPermissionDialog.targetType}
                style={dialogInputStyle}
                onChange={(event) =>
                  props.onDirectoryPermissionDialogChange((prev) => ({
                    ...prev,
                    targetType: event.target.value as "user" | "department",
                  }))}
              >
                <option value="user">User</option>
                <option value="department">Department</option>
              </select>
            </div>
            <div style={dialogFieldStyle}>
              <div style={sectionLabelStyle}>Target</div>
              <select
                value={props.directoryPermissionDialog.targetId}
                style={dialogSelectStyle}
                onChange={(event) =>
                  props.onDirectoryPermissionDialogChange((prev) => ({
                    ...prev,
                    targetId: event.target.value,
                  }))}
              >
                <option value="">请选择目标</option>
                {props.directoryPermissionDialog.targetType === "user"
                  ? props.permissionTargetUsers.map((user) => (
                      <option key={user.id} value={String(user.id)}>
                        {renderUserOption(user)}
                      </option>
                    ))
                  : props.permissionTargetDepartments.map((department) => (
                      <option key={department.id} value={String(department.id)}>
                        {department.name} #{department.id}
                      </option>
                    ))}
              </select>
            </div>
            <div style={dialogFieldStyle}>
              <div style={sectionLabelStyle}>Permission</div>
              <select
                value={props.directoryPermissionDialog.permission}
                style={dialogInputStyle}
                onChange={(event) =>
                  props.onDirectoryPermissionDialogChange((prev) => ({
                    ...prev,
                    permission: event.target.value as "read" | "read_write" | "read_public",
                  }))}
              >
                <option value="read">read</option>
                <option value="read_write">read_write</option>
                <option value="read_public">read_public</option>
              </select>
            </div>
            <div style={dialogActionsStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() =>
                  props.onDirectoryPermissionDialogChange((prev) => ({
                    ...prev,
                    open: false,
                  }))}
              >
                Cancel
              </button>
              <button type="button" style={primaryButtonStyle} onClick={props.onSubmitDirectoryPermission}>
                Save Permission
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DirectoryList({
  items,
  viewMode,
  selectedPaths,
  onSelect,
  onActivate,
  onDropOnDirectory,
}: {
  items: SelectableItem[];
  viewMode: "grid" | "list";
  selectedPaths: string[];
  onSelect: (item: SelectableItem, additive: boolean) => void;
  onActivate: (item: SelectableItem) => void;
  onDropOnDirectory: (dirPath: string, event: DragEvent<HTMLDivElement>) => void;
}) {
  if (!items.length) {
    return <div style={emptyStateStyle}>No items in this directory.</div>;
  }

  if (viewMode === "list") {
    return (
      <div style={listTableStyle}>
        {items.map((item) => {
          const selected = selectedPaths.includes(item.path);
          return (
            <div
              key={item.path}
              style={listRowStyle(selected)}
              onClick={(event) => onSelect(item, event.metaKey || event.ctrlKey)}
              onDoubleClick={() => onActivate(item)}
              draggable={item.type === "file"}
              onDragStart={(event) => {
                if (item.type === "file") event.dataTransfer.setData("text/plain", item.path);
              }}
              onDragOver={(event) => {
                if (item.type === "dir") event.preventDefault();
              }}
              onDrop={(event) => {
                if (item.type !== "dir") return;
                event.preventDefault();
                onDropOnDirectory(item.path, event);
              }}
            >
              <div style={listNameStyle}>
                <button
                  type="button"
                  aria-label={selected ? "Deselect item" : "Select item"}
                  style={selectionToggleStyle(selected)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(item, true);
                  }}
                >
                  {selected ? "✓" : ""}
                </button>
                <span>{item.type === "dir" ? "▣" : "●"}</span>
                <span>{item.name}</span>
              </div>
              <div style={listMetaStyle}>{item.path}</div>
              <div style={listMetaStyle}>{item.type === "file" ? formatBytes(item.size || 0) : "Folder"}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={gridStyle}>
      {items.map((item) => {
        const selected = selectedPaths.includes(item.path);
        return (
          <div
            key={item.path}
            style={cardStyle(selected)}
            onClick={(event) => onSelect(item, event.metaKey || event.ctrlKey)}
            onDoubleClick={() => onActivate(item)}
            draggable={item.type === "file"}
            onDragStart={(event) => {
              if (item.type === "file") event.dataTransfer.setData("text/plain", item.path);
            }}
            onDragOver={(event) => {
              if (item.type === "dir") event.preventDefault();
            }}
            onDrop={(event) => {
              if (item.type !== "dir") return;
              event.preventDefault();
              onDropOnDirectory(item.path, event);
            }}
          >
            <button
              type="button"
              aria-label={selected ? "Deselect item" : "Select item"}
              style={cardSelectionToggleStyle(selected)}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(item, true);
              }}
            >
              {selected ? "✓" : ""}
            </button>
            <div style={cardIconStyle(item.type === "dir")}>{item.type === "dir" ? "▣" : "●"}</div>
            <div style={cardNameStyle}>{item.name}</div>
            <div style={cardMetaStyle}>{item.type === "dir" ? "Folder" : formatBytes(item.size || 0)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Pagination({ total, page, onChange }: { total: number; page: number; onChange: (value: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / itemsPerPage));
  if (pages <= 1) return null;
  return (
    <div style={paginationStyle}>
      {Array.from({ length: pages }, (_, index) => index + 1).map((value) => (
        <button key={value} type="button" style={pageButtonStyle(page === value)} onClick={() => onChange(value)}>
          {value}
        </button>
      ))}
    </div>
  );
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={detailMetaCardStyle}>
      <div style={detailMetaLabelStyle}>{label}</div>
      <div style={detailMetaValueStyle}>{value}</div>
    </div>
  );
}

function PermissionGroup(props: {
  title: string;
  permissions: PermissionRow[];
  users: UserRecord[];
  departments: DepartmentRecord[];
  onRemovePermission: (permissionId: number) => void;
}) {
  return (
    <div style={detailBlockStyle}>
      <div style={sectionLabelStyle}>{props.title}</div>
      {props.permissions.map((permission) => (
        <div key={permission.id} style={permissionRowStyle}>
          <div style={{ flex: 1 }}>
            <div style={permissionMainStyle}>{renderPermissionTarget(permission, props.users, props.departments)}</div>
            <div style={permissionSubStyle}>{renderPermissionScope(permission)}</div>
          </div>
          <button type="button" style={tinyDangerButtonStyle} onClick={() => props.onRemovePermission(permission.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function renderPermissionTarget(
  permission: PermissionRow,
  users: UserRecord[],
  departments: DepartmentRecord[],
) {
  if (permission.user_id) {
    const user = users.find((row) => row.id === permission.user_id);
    return user ? `User · ${renderUserOption(user)}` : `User · #${permission.user_id}`;
  }
  if (permission.department_id) {
    const department = departments.find((row) => row.id === permission.department_id);
    return department ? `Department · ${department.name}` : `Department · #${permission.department_id}`;
  }
  return "Unknown target";
}

function renderPermissionScope(permission: PermissionRow) {
  if (permission.permission === "read_public") {
    return "Read access · public scope";
  }
  if (permission.permission === "read_write") {
    return "Read and write access";
  }
  return "Read access";
}

function renderUserOption(user: UserRecord) {
  return [user.display_name, user.username, `#${user.id}`].filter(Boolean).join(" · ");
}

function getVisibleTreePaths(paths: string[], currentPath: string) {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  if (currentPath === "/") {
    return sorted.filter((path) => path.split("/").filter(Boolean).length <= 2);
  }
  return sorted.filter(
    (path) =>
      path === currentPath ||
      currentPath.startsWith(`${path}/`) ||
      path.startsWith(`${currentPath}/`),
  );
}

function getTreeDepth(path: string, currentPath: string) {
  const currentDepth = currentPath.split("/").filter(Boolean).length;
  const pathDepth = path.split("/").filter(Boolean).length;
  return Math.max(0, pathDepth - Math.max(0, currentDepth - 1));
}

function renderTreeLabel(path: string, currentPath: string) {
  if (path === currentPath) {
    return path.split("/").filter(Boolean).slice(-1)[0] || "/";
  }
  if (path.startsWith(`${currentPath}/`)) {
    return path.slice(currentPath.length + 1) || path;
  }
  return path.split("/").filter(Boolean).slice(-1)[0] || path;
}

function selectionToggleStyle(selected: boolean): CSSProperties {
  return {
    width: "20px",
    height: "20px",
    borderRadius: "999px",
    border: selected ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
    background: selected ? "var(--x-color-accent)" : "white",
    color: "white",
    display: "inline-grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    fontSize: "12px",
    fontWeight: 700,
    flexShrink: 0,
  };
}

function cardSelectionToggleStyle(selected: boolean): CSSProperties {
  return {
    ...selectionToggleStyle(selected),
    position: "absolute",
    top: "10px",
    right: "10px",
    zIndex: 1,
  };
}

const dialogOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.42)",
  display: "grid",
  placeItems: "center",
  zIndex: 1200,
  padding: "12px",
};

const dialogPanelStyle: CSSProperties = {
  width: "min(460px, 100%)",
  display: "grid",
  gap: "8px",
  padding: "12px",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 12px 28px var(--x-color-shadow-medium)",
};

const dialogFieldStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const dialogInputStyle: CSSProperties = {
  width: "100%",
  minHeight: "32px",
  padding: "0 8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-strong)",
  color: "var(--x-color-ink)",
};

const dialogSelectStyle: CSSProperties = {
  ...dialogInputStyle,
};

const dialogActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "6px",
  flexWrap: "wrap",
};
