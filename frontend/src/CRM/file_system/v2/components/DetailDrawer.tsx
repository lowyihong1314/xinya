import { useFsActions, useFsState } from "../context";
import {
  drawerBodyStyle,
  drawerHeaderStyle,
  drawerSectionTitleStyle,
  drawerStyle,
  iconButtonStyle,
  itemIconStyle,
  metaLabelStyle,
  metaRowStyle,
  metaValueStyle,
  permissionBadgeStyle,
  permissionRowStyle,
} from "../styles";
import type { PermissionRow } from "../types";
import { fileIcon, formatBytes, formatDateTime } from "../utils";

const PERMISSION_LABELS: Record<string, string> = {
  read: "只读",
  read_write: "读写",
  read_public: "公开可读",
};

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  upload: "上传",
  rename: "重命名",
  move: "移动",
  restore: "恢复",
  remove_permission: "移除权限",
  add_permission: "添加权限",
};

export function DetailDrawer() {
  const { drawer, users, departments, isMobile } = useFsState();
  const actions = useFsActions();
  const { open, item, detail, dirDetail, permissions } = drawer;

  function userName(userId?: number | null) {
    if (!userId) return "—";
    const user = users.find((entry) => entry.id === userId);
    return user?.display_name || user?.username || `用户 #${userId}`;
  }

  function departmentName(departmentId?: number | null) {
    if (!departmentId) return null;
    return departments.find((entry) => entry.id === departmentId)?.name || `部门 #${departmentId}`;
  }

  function permissionTarget(permission: PermissionRow) {
    if (permission.department_id) return `${departmentName(permission.department_id)}（部门）`;
    if (permission.user_id) return userName(permission.user_id);
    return "所有人";
  }

  return (
    <aside style={drawerStyle(open, isMobile)}>
      {item ? (
        <>
          <div style={drawerHeaderStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
              <i className={fileIcon(item)} style={itemIconStyle(item.type === "dir")} />
              <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </span>
            </div>
            <button type="button" style={iconButtonStyle()} title="关闭" onClick={actions.closeDrawer}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div style={drawerBodyStyle}>
            <section>
              <div style={drawerSectionTitleStyle}>基本信息</div>
              <div style={metaRowStyle}>
                <span style={metaLabelStyle}>路径</span>
                <span style={metaValueStyle}>{item.path}</span>
              </div>
              {item.type === "dir" ? (
                dirDetail ? (
                  <>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>文件数</span>
                      <span style={metaValueStyle}>{dirDetail.file_count}</span>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>子目录数</span>
                      <span style={metaValueStyle}>{dirDetail.sub_dir_count}</span>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>总大小</span>
                      <span style={metaValueStyle}>{formatBytes(dirDetail.total_size)}</span>
                    </div>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>创建时间</span>
                      <span style={metaValueStyle}>{formatDateTime(dirDetail.created_at)}</span>
                    </div>
                  </>
                ) : (
                  <LoadingHint />
                )
              ) : detail ? (
                <>
                  <div style={metaRowStyle}>
                    <span style={metaLabelStyle}>大小</span>
                    <span style={metaValueStyle}>{formatBytes(detail.file_size || 0)}</span>
                  </div>
                  <div style={metaRowStyle}>
                    <span style={metaLabelStyle}>类型</span>
                    <span style={metaValueStyle}>{detail.file_type || "未知"}</span>
                  </div>
                  <div style={metaRowStyle}>
                    <span style={metaLabelStyle}>所有者</span>
                    <span style={metaValueStyle}>{userName(detail.owner_id)}</span>
                  </div>
                  <div style={metaRowStyle}>
                    <span style={metaLabelStyle}>创建时间</span>
                    <span style={metaValueStyle}>{formatDateTime(detail.created_at)}</span>
                  </div>
                  <div style={metaRowStyle}>
                    <span style={metaLabelStyle}>修改时间</span>
                    <span style={metaValueStyle}>{formatDateTime(detail.updated_at)}</span>
                  </div>
                </>
              ) : (
                <LoadingHint />
              )}
            </section>

            {item.type === "file" ? (
              <section>
                <div style={drawerSectionTitleStyle}>访问权限</div>
                {permissions.length ? (
                  permissions.map((permission) => (
                    <div key={permission.id} style={permissionRowStyle}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {permissionTarget(permission)}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={permissionBadgeStyle(permission.permission)}>
                          {PERMISSION_LABELS[permission.permission] || permission.permission}
                        </span>
                        <button
                          type="button"
                          style={{ border: "none", background: "transparent", color: "var(--x-color-danger)", cursor: "pointer" }}
                          title="移除该权限"
                          onClick={() => actions.removePermission(permission.id)}
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </span>
                    </div>
                  ))
                ) : (
                  <span style={{ fontSize: 12.5, color: "var(--x-color-ink-muted)" }}>暂无权限记录</span>
                )}
              </section>
            ) : (
              <section>
                <div style={drawerSectionTitleStyle}>目录权限</div>
                <button
                  type="button"
                  style={{
                    border: "1px solid var(--x-color-accent-border)",
                    background: "var(--x-color-accent-tint)",
                    color: "var(--x-color-accent-strong)",
                    borderRadius: 8,
                    padding: "7px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                  onClick={() => actions.openDialog({ kind: "dirPermission", dir: item })}
                >
                  <i className="fa-solid fa-user-shield" style={{ marginRight: 6 }} /> 设置目录权限
                </button>
              </section>
            )}

            {item.type === "file" && detail?.history?.length ? (
              <section>
                <div style={drawerSectionTitleStyle}>最近操作</div>
                {detail.history.slice(0, 8).map((entry) => (
                  <div key={entry.id} style={metaRowStyle}>
                    <span style={metaLabelStyle}>
                      {ACTION_LABELS[entry.action] || entry.action} · {entry.user_name || userName(entry.user_id)}
                    </span>
                    <span style={{ ...metaValueStyle, color: "var(--x-color-ink-muted)", fontSize: 12 }}>
                      {formatDateTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}

function LoadingHint() {
  return (
    <span style={{ fontSize: 12.5, color: "var(--x-color-ink-muted)" }}>
      <i className="fa-solid fa-circle-notch fa-spin" style={{ marginRight: 6 }} />
      加载中…
    </span>
  );
}
