import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { DepartmentRecord, PermissionRecord, UserRecord } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;

export function UserControlView(props: {
  isMobile?: boolean;
  departments: DepartmentRecord[];
  selectedDepartment: DepartmentRecord | null;
  selectedDepartmentId: number | null;
  departmentUsers: UserRecord[];
  filteredUsers: UserRecord[];
  allPermissions: PermissionRecord[];
  selectedUser: UserRecord | null;
  search: string;
  loading: boolean;
  toast: Toast;
  userEditorOpen: boolean;
  newUserOpen: boolean;
  permissionOpen: boolean;
  onSelectDepartment: (departmentId: number) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenUser: (userId: number) => void;
  onOpenNewUser: () => void;
  onCloseNewUser: () => void;
  onCreateUser: (payload: { username: string; email: string; phone?: string; password: string }) => void;
  onCreateDepartment: (name: string) => void;
  onDeleteDepartment: (departmentId: number) => void;
  onAttachUser: (departmentId: number, userId: number) => void;
  onDetachUser: (departmentId: number, userId: number) => void;
  onOpenPermissionEditor: () => void;
  onClosePermissionEditor: () => void;
  onSavePermissions: (departmentId: number, nextIds: number[]) => void;
  onCloseUserEditor: () => void;
  onSaveUser: (payload: Record<string, unknown>) => void;
  onDeleteUser: (userId: number) => void;
  onResetPassword: (userId: number) => void;
}) {
  const isMobile = props.isMobile ?? false;
  const [newDepartmentName, setNewDepartmentName] = useState("");

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>User Control</div>
          <h3 style={titleStyle}>用户管理</h3>
        </div>
        <div style={toolbarStyle(isMobile)}>
          <button type="button" style={secondaryButtonStyle} onClick={props.onRefresh}>
            刷新
          </button>
          <button type="button" style={primaryButtonStyle} onClick={props.onOpenNewUser}>
            新增用户
          </button>
        </div>
      </header>

      {props.toast ? (
        <div style={props.toast.type === "success" ? successBannerStyle : errorBannerStyle}>{props.toast.text}</div>
      ) : null}

      <div style={layoutStyle(isMobile)}>
        <section style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={sectionEyebrowStyle}>Departments</div>
              <h4 style={sectionTitleStyle}>部门</h4>
            </div>
          </div>
          <div style={createRowStyle(isMobile)}>
            <input
              style={inputStyle}
              value={newDepartmentName}
              placeholder="新部门名称"
              onChange={(event) => setNewDepartmentName(event.target.value)}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => {
                if (!newDepartmentName.trim()) return;
                props.onCreateDepartment(newDepartmentName.trim());
                setNewDepartmentName("");
              }}
            >
              添加
            </button>
          </div>
          <div style={departmentListStyle}>
            {props.departments.map((department) => (
              <button
                key={department.id}
                type="button"
                style={departmentCardStyle(props.selectedDepartmentId === department.id)}
                onClick={() => props.onSelectDepartment(department.id)}
              >
                <div style={departmentTitleStyle}>{department.name}</div>
                <div style={departmentMetaStyle}>{(department.permissions || []).length} 个权限</div>
              </button>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={sectionEyebrowStyle}>Department Users</div>
              <h4 style={sectionTitleStyle}>{props.selectedDepartment?.name || "未选择部门"}</h4>
            </div>
            {props.selectedDepartment ? (
              <div style={toolbarStyle(isMobile)}>
                <button type="button" style={secondaryButtonStyle} onClick={props.onOpenPermissionEditor}>
                  权限
                </button>
                <button
                  type="button"
                  style={dangerButtonStyle}
                  onClick={() => props.onDeleteDepartment(props.selectedDepartment!.id)}
                >
                  删除部门
                </button>
              </div>
            ) : null}
          </div>
          {props.loading ? <div style={placeholderStyle}>读取中…</div> : null}
          {!props.loading && !props.departmentUsers.length ? <div style={placeholderStyle}>该部门暂无成员</div> : null}
          <div style={cardGridStyle}>
            {props.departmentUsers.map((user) => (
              <UserCard
                key={user.id}
                user={user}
                actionLabel="移出"
                actionTone="danger"
                onOpen={() => props.onOpenUser(user.id)}
                onAction={
                  props.selectedDepartment ? () => props.onDetachUser(props.selectedDepartment!.id, user.id) : undefined
                }
              />
            ))}
          </div>
        </section>
      </div>

      <section style={panelStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>All Users</div>
            <h4 style={sectionTitleStyle}>成员</h4>
          </div>
          <input
            style={searchStyle(isMobile)}
            value={props.search}
            placeholder="搜索姓名 / 用户名 / 邮箱 / 电话"
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
        </div>
        <div style={cardGridStyle}>
          {props.filteredUsers.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              actionLabel={props.selectedDepartment ? "加入部门" : undefined}
              actionTone="default"
              onOpen={() => props.onOpenUser(user.id)}
              onAction={
                props.selectedDepartment ? () => props.onAttachUser(props.selectedDepartment!.id, user.id) : undefined
              }
            />
          ))}
        </div>
      </section>

      {props.newUserOpen ? (
        <NewUserModal onClose={props.onCloseNewUser} onSubmit={props.onCreateUser} />
      ) : null}

      {props.userEditorOpen && props.selectedUser ? (
        <UserEditorModal
          user={props.selectedUser}
          onClose={props.onCloseUserEditor}
          onSave={props.onSaveUser}
          onDelete={() => props.onDeleteUser(props.selectedUser!.id)}
          onResetPassword={() => props.onResetPassword(props.selectedUser!.id)}
        />
      ) : null}

      {props.permissionOpen && props.selectedDepartment ? (
        <PermissionModal
          department={props.selectedDepartment}
          permissions={props.allPermissions}
          onClose={props.onClosePermissionEditor}
          onSave={(ids) => props.onSavePermissions(props.selectedDepartment!.id, ids)}
        />
      ) : null}
    </div>
  );
}

export function UserCard({
  user,
  actionLabel,
  actionTone,
  onOpen,
  onAction,
}: {
  user: UserRecord;
  actionLabel?: string;
  actionTone?: "default" | "danger";
  onOpen?: () => void;
  onAction?: () => void;
}) {
  const body = (
    <>
      <img
        src={`/api/user_control/get_profile_image/${user.id}`}
        alt={user.display_name || user.username || String(user.id)}
        style={avatarStyle}
      />
      <div style={userNameStyle}>{user.display_name || user.username || `#${user.id}`}</div>
      <div style={userMetaStyle}>{user.email || user.phone || "-"}</div>
    </>
  );

  return (
    <div style={userCardStyle}>
      {onOpen ? (
        <button type="button" style={userOpenStyle} onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div style={readOnlyUserCardBodyStyle}>{body}</div>
      )}
      {actionLabel && onAction ? (
        <button type="button" style={actionButtonStyle(actionTone === "danger")} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function NewUserModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: { username: string; email: string; phone?: string; password: string }) => void;
}) {
  const [form, setForm] = useState({ username: "", email: "", phone: "", password: "" });
  return (
    <ModalFrame title="新增用户" onClose={onClose}>
      <div style={formGridStyle}>
        <Field label="用户名" value={form.username} onChange={(value) => setForm((prev) => ({ ...prev, username: value }))} />
        <Field label="邮箱" value={form.email} onChange={(value) => setForm((prev) => ({ ...prev, email: value }))} />
        <Field label="电话" value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} />
        <Field label="密码" value={form.password} type="password" onChange={(value) => setForm((prev) => ({ ...prev, password: value }))} />
      </div>
      <div style={modalFooterStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>
          取消
        </button>
        <button type="button" style={primaryButtonStyle} onClick={() => onSubmit(form)}>
          保存
        </button>
      </div>
    </ModalFrame>
  );
}

function UserEditorModal({
  user,
  onClose,
  onSave,
  onDelete,
  onResetPassword,
}: {
  user: UserRecord;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
  onResetPassword: () => void;
}) {
  const [form, setForm] = useState({
    display_name: user.display_name || "",
    email: user.email || "",
    phone: user.phone || "",
    name_NRIC: user.name_NRIC || "",
    display: Boolean(user.display),
    NRIC: user.NRIC || "",
    gender: user.gender || "",
    parent_1: user.parent_1 || "",
    parent_1_phone: user.parent_1_phone || "",
    medical: user.medical || "",
    allergy: user.allergy || "",
  });

  return (
    <ModalFrame title={`编辑用户：${user.display_name || user.username || user.id}`} onClose={onClose}>
      <div style={formGridStyle}>
        <Field
          label="显示名称"
          value={form.display_name}
          onChange={(value) => setForm((prev) => ({ ...prev, display_name: value }))}
        />
        <Field label="邮箱" value={form.email} onChange={(value) => setForm((prev) => ({ ...prev, email: value }))} />
        <Field label="电话" value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} />
        <Field label="姓名 (NRIC)" value={form.name_NRIC} onChange={(value) => setForm((prev) => ({ ...prev, name_NRIC: value }))} />
        <Field label="NRIC" value={form.NRIC} onChange={(value) => setForm((prev) => ({ ...prev, NRIC: value }))} />
        <Field label="性别" value={form.gender} onChange={(value) => setForm((prev) => ({ ...prev, gender: value }))} />
        <Field label="家长 1" value={form.parent_1} onChange={(value) => setForm((prev) => ({ ...prev, parent_1: value }))} />
        <Field label="家长 1 电话" value={form.parent_1_phone} onChange={(value) => setForm((prev) => ({ ...prev, parent_1_phone: value }))} />
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={form.display}
            onChange={(event) => setForm((prev) => ({ ...prev, display: event.target.checked }))}
          />
          <span>对外显示</span>
        </label>
        <Field label="病史" value={form.medical} textarea onChange={(value) => setForm((prev) => ({ ...prev, medical: value }))} />
        <Field label="过敏" value={form.allergy} textarea onChange={(value) => setForm((prev) => ({ ...prev, allergy: value }))} />
      </div>
      <div style={modalFooterStyle}>
        <button type="button" style={dangerButtonStyle} onClick={onDelete}>
          删除
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={onResetPassword}>
          重置密码
        </button>
        <button type="button" style={primaryButtonStyle} onClick={() => onSave(form)}>
          保存
        </button>
      </div>
    </ModalFrame>
  );
}

function PermissionModal({
  department,
  permissions,
  onClose,
  onSave,
}: {
  department: DepartmentRecord;
  permissions: PermissionRecord[];
  onClose: () => void;
  onSave: (ids: number[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>(
    (department.permissions || []).map((permission) => permission.id),
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <ModalFrame title={`编辑权限：${department.name}`} onClose={onClose}>
      <div style={permissionGridStyle}>
        {permissions.map((permission) => (
          <label key={permission.id} style={permissionItemStyle(selectedSet.has(permission.id))}>
            <input
              type="checkbox"
              checked={selectedSet.has(permission.id)}
              onChange={(event) =>
                setSelectedIds((prev) =>
                  event.target.checked ? [...prev, permission.id] : prev.filter((id) => id !== permission.id),
                )
              }
            />
            <span>{permission.name}</span>
          </label>
        ))}
      </div>
      <div style={modalFooterStyle}>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>
          取消
        </button>
        <button type="button" style={primaryButtonStyle} onClick={() => onSave(selectedIds)}>
          保存权限
        </button>
      </div>
    </ModalFrame>
  );
}

function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h4 style={modalTitleStyle}>{title}</h4>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  type?: string;
}) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {textarea ? (
        <textarea rows={4} style={textareaStyle} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input type={type} style={inputStyle} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

const pageStyle: CSSProperties = { display: "grid", gap: "18px" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" };
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const titleStyle: CSSProperties = { margin: "8px 0 0", fontSize: "30px", lineHeight: 1.1, color: "var(--x-color-ink)" };
function toolbarStyle(isMobile: boolean): CSSProperties { return { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", width: isMobile ? "100%" : undefined }; }
function layoutStyle(isMobile: boolean): CSSProperties { return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "300px minmax(0, 1fr)", gap: "18px" }; }
const panelStyle: CSSProperties = { padding: "20px", borderRadius: "var(--x-radius-lg)", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 14px 34px var(--x-color-shadow-soft)", display: "grid", gap: "16px" };
const panelHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center", flexWrap: "wrap" };
const sectionEyebrowStyle: CSSProperties = eyebrowStyle;
const sectionTitleStyle: CSSProperties = { margin: "6px 0 0", fontSize: "22px", color: "var(--x-color-ink)" };
function createRowStyle(isMobile: boolean): CSSProperties { return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) auto", gap: "10px" }; }
const departmentListStyle: CSSProperties = { display: "grid", gap: "10px" };
const departmentCardStyle = (active: boolean): CSSProperties => ({ textAlign: "left", padding: "14px", borderRadius: "var(--x-radius-md)", border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel)", cursor: "pointer" });
const departmentTitleStyle: CSSProperties = { fontWeight: 700, color: "var(--x-color-ink)" };
const departmentMetaStyle: CSSProperties = { marginTop: "4px", fontSize: "12px", color: "var(--x-color-ink-muted)" };
const cardGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "14px" };
const userCardStyle: CSSProperties = { borderRadius: "var(--x-radius-md)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", overflow: "hidden", boxShadow: "0 10px 22px var(--x-color-shadow-soft)" };
const userOpenStyle: CSSProperties = { width: "100%", padding: "16px", display: "grid", justifyItems: "center", gap: "8px", border: "none", background: "transparent", cursor: "pointer" };
const readOnlyUserCardBodyStyle: CSSProperties = { padding: "16px", display: "grid", justifyItems: "center", gap: "8px", textAlign: "center" };
const avatarStyle: CSSProperties = { width: "86px", height: "86px", borderRadius: "50%", objectFit: "cover", border: "3px solid var(--x-color-panel-strong)" };
const userNameStyle: CSSProperties = { fontWeight: 700, color: "var(--x-color-ink)", textAlign: "center" };
const userMetaStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", textAlign: "center", wordBreak: "break-word" };
const actionButtonStyle = (danger?: boolean): CSSProperties => ({ width: "100%", padding: "10px 12px", border: "none", borderTop: "1px solid var(--x-color-line-soft)", background: danger ? "var(--x-color-danger-soft)" : "var(--x-color-accent-tint)", color: danger ? "var(--x-color-danger)" : "var(--x-color-accent-strong)", fontWeight: 700, cursor: "pointer" });
const placeholderStyle: CSSProperties = { padding: "24px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", color: "var(--x-color-ink-muted)" };
function searchStyle(isMobile: boolean): CSSProperties { return { minWidth: isMobile ? "0" : "320px", maxWidth: isMobile ? "100%" : "420px", width: "100%", minHeight: "46px", padding: "12px 14px", borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", boxSizing: "border-box" }; }
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, background: "rgba(9,16,29,0.6)", display: "grid", placeItems: "center", zIndex: 5000, padding: "24px" };
const modalStyle: CSSProperties = { width: "min(820px, 100%)", maxHeight: "90vh", overflow: "auto", padding: "22px", borderRadius: "var(--x-radius-lg)", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 24px 54px var(--x-color-shadow-strong)", display: "grid", gap: "16px" };
const modalHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center", flexWrap: "wrap" };
const modalTitleStyle: CSSProperties = { margin: 0, fontSize: "24px", color: "var(--x-color-ink)" };
const formGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "14px" };
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const fieldLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", minHeight: "46px", padding: "12px 14px", borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", boxSizing: "border-box" };
const textareaStyle: CSSProperties = { ...inputStyle, minHeight: "120px", resize: "vertical" };
const modalFooterStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" };
const checkboxRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", minHeight: "46px", color: "var(--x-color-ink)" };
const permissionGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" };
const permissionItemStyle = (active: boolean): CSSProperties => ({ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", borderRadius: "var(--x-radius-sm)", border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel)" });
const primaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer" };
const dangerButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, cursor: "pointer" };
const successBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" };
const errorBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
