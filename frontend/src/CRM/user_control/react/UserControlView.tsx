import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { CachedImage } from "../../../components/CachedMedia";
import { API_BASE } from "../../../js/apiBase";
import { showPromptDialog } from "../../../js/dialogs";
import type { DepartmentRecord, MemberRenewalRecord, PermissionRecord, UserRecord } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;

const ALL_USERS_PAGE_SIZE_DESKTOP = 10;
const ALL_USERS_PAGE_SIZE_MOBILE = 8;
const DEPARTMENT_USERS_PAGE_SIZE = 8;

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
  onRenameDepartment: (departmentId: number, name: string) => void;
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
  onCreateRenewal: (payload: { renewal_date: string; note?: string; proof?: File | null }) => void;
  onDeleteRenewal: (renewalId: number) => void;
}) {
  const isMobile = props.isMobile ?? false;
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentUsersPage, setDepartmentUsersPage] = useState(1);
  const [allUsersPage, setAllUsersPage] = useState(1);
  const departmentUsersPageCount = Math.max(1, Math.ceil(props.departmentUsers.length / DEPARTMENT_USERS_PAGE_SIZE));
  const safeDepartmentUsersPage = Math.min(departmentUsersPage, departmentUsersPageCount);
  const pagedDepartmentUsers = useMemo(
    () =>
      props.departmentUsers.slice(
        (safeDepartmentUsersPage - 1) * DEPARTMENT_USERS_PAGE_SIZE,
        safeDepartmentUsersPage * DEPARTMENT_USERS_PAGE_SIZE,
      ),
    [props.departmentUsers, safeDepartmentUsersPage],
  );
  const allUsersPageSize = isMobile ? ALL_USERS_PAGE_SIZE_MOBILE : ALL_USERS_PAGE_SIZE_DESKTOP;
  const allUsersPageCount = Math.max(1, Math.ceil(props.filteredUsers.length / allUsersPageSize));
  const safeAllUsersPage = Math.min(allUsersPage, allUsersPageCount);
  const pagedAllUsers = useMemo(
    () => props.filteredUsers.slice((safeAllUsersPage - 1) * allUsersPageSize, safeAllUsersPage * allUsersPageSize),
    [allUsersPageSize, props.filteredUsers, safeAllUsersPage],
  );

  useEffect(() => {
    setDepartmentUsersPage(1);
  }, [props.selectedDepartmentId]);

  useEffect(() => {
    if (departmentUsersPage !== safeDepartmentUsersPage) {
      setDepartmentUsersPage(safeDepartmentUsersPage);
    }
  }, [departmentUsersPage, safeDepartmentUsersPage]);

  useEffect(() => {
    setAllUsersPage(1);
  }, [props.search]);

  useEffect(() => {
    if (allUsersPage !== safeAllUsersPage) {
      setAllUsersPage(safeAllUsersPage);
    }
  }, [allUsersPage, safeAllUsersPage]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>User Control</div>
          <h3 style={titleStyle}>{props.userEditorOpen && props.selectedUser ? "编辑用户" : "用户管理"}</h3>
        </div>
        <div style={toolbarStyle(isMobile)}>
          {props.userEditorOpen && props.selectedUser ? (
            <button type="button" style={secondaryButtonStyle} onClick={props.onCloseUserEditor}>
              返回列表
            </button>
          ) : (
            <>

              <button type="button" style={primaryButtonStyle} onClick={props.onOpenNewUser}>
                新增用户
              </button>
            </>
          )}
        </div>
      </header>

      {props.toast ? (
        <div style={props.toast.type === "success" ? successBannerStyle : errorBannerStyle}>{props.toast.text}</div>
      ) : null}

      {props.userEditorOpen && props.selectedUser ? (
        <section style={editorPageShellStyle}>
          <UserEditorPage
            user={props.selectedUser}
            onBack={props.onCloseUserEditor}
            onSave={props.onSaveUser}
            onDelete={() => props.onDeleteUser(props.selectedUser!.id)}
            onResetPassword={() => props.onResetPassword(props.selectedUser!.id)}
            onCreateRenewal={props.onCreateRenewal}
            onDeleteRenewal={props.onDeleteRenewal}
          />
        </section>
      ) : (
        <>
          <div style={layoutStyle(isMobile)}>
            <section style={departmentPanelStyle(isMobile)}>
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

            <section style={departmentUsersPanelStyle}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={sectionEyebrowStyle}>Department Users</div>
                  <h4 style={sectionTitleStyle}>{props.selectedDepartment?.name || "未选择部门"}</h4>
                </div>
                {props.selectedDepartment ? (
                  <div style={toolbarStyle(isMobile)}>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={() => {
                        void (async () => {
                          const currentName = props.selectedDepartment?.name || "";
                          const nextName = await showPromptDialog({
                            title: "部门改名",
                            message: "请输入新的部门名称",
                            initialValue: currentName,
                            placeholder: "部门名称",
                          });
                          if (nextName === null) {
                            return;
                          }
                          const trimmed = nextName.trim();
                          if (!trimmed || trimmed === currentName) {
                            return;
                          }
                          props.onRenameDepartment(props.selectedDepartment!.id, trimmed);
                        })();
                      }}
                    >
                      改名
                    </button>
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
              {!props.loading && props.departmentUsers.length ? (
                <div style={listSummaryStyle(isMobile)}>
                  <div style={listMetaStyle}>
                    共 {props.departmentUsers.length} 人 · 第 {safeDepartmentUsersPage} / {departmentUsersPageCount} 页
                  </div>
                  <div style={paginationActionsStyle}>
                    <button
                      type="button"
                      style={paginationButtonStyle(safeDepartmentUsersPage <= 1)}
                      onClick={() => setDepartmentUsersPage((prev) => Math.max(1, prev - 1))}
                      disabled={safeDepartmentUsersPage <= 1}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      style={paginationButtonStyle(safeDepartmentUsersPage >= departmentUsersPageCount)}
                      onClick={() => setDepartmentUsersPage((prev) => Math.min(departmentUsersPageCount, prev + 1))}
                      disabled={safeDepartmentUsersPage >= departmentUsersPageCount}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}
              <div style={cardGridStyle}>
                {pagedDepartmentUsers.map((user) => (
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
            <div style={listSummaryStyle(isMobile)}>
              <div style={listMetaStyle}>
                共 {props.filteredUsers.length} 人 · 第 {safeAllUsersPage} / {allUsersPageCount} 页
              </div>
              <div style={paginationActionsStyle}>
                <button
                  type="button"
                  style={paginationButtonStyle(safeAllUsersPage <= 1)}
                  onClick={() => setAllUsersPage((prev) => Math.max(1, prev - 1))}
                  disabled={safeAllUsersPage <= 1}
                >
                  上一页
                </button>
                <button
                  type="button"
                  style={paginationButtonStyle(safeAllUsersPage >= allUsersPageCount)}
                  onClick={() => setAllUsersPage((prev) => Math.min(allUsersPageCount, prev + 1))}
                  disabled={safeAllUsersPage >= allUsersPageCount}
                >
                  下一页
                </button>
              </div>
            </div>
            {!props.filteredUsers.length ? <div style={placeholderStyle}>没有匹配的成员</div> : null}
            <div style={cardGridStyle}>
              {pagedAllUsers.map((user) => (
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
        </>
      )}

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
      <CachedImage
        src={`${API_BASE}/api/user_control/get_profile_image/${user.id}`}
        cacheKey={`user-control-avatar:${user.id}`}
        alt={user.display_name || user.username || String(user.id)}
        style={avatarStyle}
      />
      <div style={userNameStyle}>{user.display_name || user.username || `#${user.id}`}</div>
      <div style={memberBadgeStyle(Boolean(user.is_member))}>{user.is_member ? "会员" : "非会员"}</div>
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

function UserEditorPage({
  user,
  onBack,
  onSave,
  onDelete,
  onResetPassword,
  onCreateRenewal,
  onDeleteRenewal,
}: {
  user: UserRecord;
  onBack: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
  onResetPassword: () => void;
  onCreateRenewal: (payload: { renewal_date: string; note?: string; proof?: File | null }) => void;
  onDeleteRenewal: (renewalId: number) => void;
}) {
  const [form, setForm] = useState({
    display_name: user.display_name || "",
    email: user.email || "",
    phone: user.phone || "",
    name_NRIC: user.name_NRIC || "",
    display: Boolean(user.display),
    is_member: Boolean(user.is_member),
    NRIC: user.NRIC || "",
    gender: user.gender || "",
    parent_1: user.parent_1 || "",
    parent_1_phone: user.parent_1_phone || "",
    medical: user.medical || "",
    allergy: user.allergy || "",
  });
  const [renewalForm, setRenewalForm] = useState<{ renewal_date: string; note: string; proof: File | null }>({
    renewal_date: "",
    note: "",
    proof: null,
  });

  return (
    <div style={editorPageStyle}>
      <div style={editorPageHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>User Detail</div>
          <h4 style={editorPageTitleStyle}>{user.display_name || user.username || user.id}</h4>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={onBack}>
          返回列表
        </button>
      </div>
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
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={form.is_member}
            onChange={(event) => setForm((prev) => ({ ...prev, is_member: event.target.checked }))}
          />
          <span>会员</span>
        </label>
        <Field label="病史" value={form.medical} textarea onChange={(value) => setForm((prev) => ({ ...prev, medical: value }))} />
        <Field label="过敏" value={form.allergy} textarea onChange={(value) => setForm((prev) => ({ ...prev, allergy: value }))} />
      </div>
      <div style={renewalSectionStyle}>
        <div style={renewalSectionHeaderStyle}>
          <div style={fieldLabelStyle}>会员续费历史</div>
        </div>
        <div style={renewalFormStyle}>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>续费日期</span>
            <input
              type="date"
              style={inputStyle}
              value={renewalForm.renewal_date}
              onChange={(event) => setRenewalForm((prev) => ({ ...prev, renewal_date: event.target.value }))}
            />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>备注</span>
            <input
              type="text"
              style={inputStyle}
              value={renewalForm.note}
              onChange={(event) => setRenewalForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>证明</span>
            <input
              type="file"
              style={inputStyle}
              onChange={(event) => setRenewalForm((prev) => ({ ...prev, proof: event.target.files?.[0] || null }))}
            />
          </label>
          <div style={renewalActionWrapStyle}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => {
                onCreateRenewal(renewalForm);
                setRenewalForm({ renewal_date: "", note: "", proof: null });
              }}
            >
              新增续费
            </button>
          </div>
        </div>
        <div style={renewalListStyle}>
          {(user.member_renewals || []).length ? (
            (user.member_renewals || []).map((item) => <RenewalCard key={item.id} item={item} onDelete={() => onDeleteRenewal(item.id)} />)
          ) : (
            <div style={placeholderStyle}>还没有续费记录</div>
          )}
        </div>
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
    </div>
  );
}

function RenewalCard({ item, onDelete }: { item: MemberRenewalRecord; onDelete: () => void }) {
  return (
    <div style={renewalCardStyle}>
      <div style={renewalMetaStyle}>
        <div style={renewalDateStyle}>{item.renewal_date || "-"}</div>
        <div style={renewalInfoStyle}>
          {item.created_by_name ? `录入：${item.created_by_name}` : ""}
          {item.note ? `${item.created_by_name ? " · " : ""}${item.note}` : ""}
        </div>
      </div>
      <div style={attachmentActionRowStyle}>
        {item.proof_path ? (
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => window.open(`/media_file/${item.proof_path}`, "_blank", "noopener,noreferrer")}
          >
            查看证明
          </button>
        ) : null}
        <button type="button" style={dangerButtonStyle} onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
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
function layoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: "stretch",
    gap: "18px",
  };
}
const panelFrameStyle: CSSProperties = { padding: "20px", borderRadius: "var(--x-radius-lg)", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 14px 34px var(--x-color-shadow-soft)" };
const panelStyle: CSSProperties = { ...panelFrameStyle, display: "grid", gap: "16px" };
function departmentPanelStyle(isMobile: boolean): CSSProperties {
  return {
    ...panelFrameStyle,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    flex: isMobile ? "1 1 auto" : "0 0 300px",
    minWidth: 0,
    maxHeight: isMobile ? undefined : "calc(100vh - 220px)",
    overflow: "hidden",
  };
}
const departmentUsersPanelStyle: CSSProperties = {
  ...panelFrameStyle,
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  flex: "1 1 0",
  minWidth: 0,
};
const panelHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center", flexWrap: "wrap" };
const sectionEyebrowStyle: CSSProperties = eyebrowStyle;
const sectionTitleStyle: CSSProperties = { margin: "6px 0 0", fontSize: "22px", color: "var(--x-color-ink)" };
function createRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: "stretch",
    gap: "10px",
  };
}
const departmentListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  paddingRight: "4px",
};
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
const memberBadgeStyle = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "24px", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 800, background: active ? "var(--x-color-success-soft)" : "var(--x-color-panel-alt)", color: active ? "var(--x-color-success)" : "var(--x-color-ink-muted)", border: active ? "1px solid rgba(21,128,61,0.16)" : "1px solid var(--x-color-line-soft)" });
const actionButtonStyle = (danger?: boolean): CSSProperties => ({ width: "100%", padding: "10px 12px", border: "none", borderTop: "1px solid var(--x-color-line-soft)", background: danger ? "var(--x-color-danger-soft)" : "var(--x-color-accent-tint)", color: danger ? "var(--x-color-danger)" : "var(--x-color-accent-strong)", fontWeight: 700, cursor: "pointer" });
const placeholderStyle: CSSProperties = { padding: "24px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", color: "var(--x-color-ink-muted)" };
function listSummaryStyle(isMobile: boolean): CSSProperties { return { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" }; }
const listMetaStyle: CSSProperties = { fontSize: "13px", color: "var(--x-color-ink-muted)" };
const paginationActionsStyle: CSSProperties = { display: "flex", gap: "10px", flexWrap: "wrap" };
function paginationButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...secondaryButtonStyle,
    padding: "10px 14px",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
function searchStyle(isMobile: boolean): CSSProperties { return { minWidth: isMobile ? "0" : "320px", maxWidth: isMobile ? "100%" : "420px", width: "100%", minHeight: "46px", padding: "12px 14px", borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", boxSizing: "border-box" }; }
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, background: "rgba(9,16,29,0.6)", display: "grid", placeItems: "center", zIndex: 5000, padding: "24px" };
const modalStyle: CSSProperties = { width: "min(820px, 100%)", maxHeight: "90vh", overflow: "auto", padding: "22px", borderRadius: "var(--x-radius-lg)", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 24px 54px var(--x-color-shadow-strong)", display: "grid", gap: "16px" };
const modalHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center", flexWrap: "wrap" };
const modalTitleStyle: CSSProperties = { margin: 0, fontSize: "24px", color: "var(--x-color-ink)" };
const editorPageShellStyle: CSSProperties = { padding: "20px", borderRadius: "var(--x-radius-lg)", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 14px 34px var(--x-color-shadow-soft)" };
const editorPageStyle: CSSProperties = { display: "grid", gap: "18px" };
const editorPageHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "center", flexWrap: "wrap" };
const editorPageTitleStyle: CSSProperties = { margin: "6px 0 0", fontSize: "28px", color: "var(--x-color-ink)" };
const formGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "14px" };
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const fieldLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", minHeight: "46px", padding: "12px 14px", borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", boxSizing: "border-box" };
const textareaStyle: CSSProperties = { ...inputStyle, minHeight: "120px", resize: "vertical" };
const modalFooterStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" };
const checkboxRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", minHeight: "46px", color: "var(--x-color-ink)" };
const permissionGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" };
const renewalSectionStyle: CSSProperties = { display: "grid", gap: "12px", paddingTop: "8px", borderTop: "1px solid var(--x-color-line-soft)" };
const renewalSectionHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between" };
const renewalFormStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "14px" };
const renewalActionWrapStyle: CSSProperties = { display: "flex", alignItems: "end" };
const renewalListStyle: CSSProperties = { display: "grid", gap: "10px" };
const renewalCardStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "14px 16px", borderRadius: "var(--x-radius-md)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const renewalMetaStyle: CSSProperties = { display: "grid", gap: "4px" };
const renewalDateStyle: CSSProperties = { fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" };
const renewalInfoStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const attachmentActionRowStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap" };
const permissionItemStyle = (active: boolean): CSSProperties => ({ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", borderRadius: "var(--x-radius-sm)", border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel)" });
const primaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer" };
const dangerButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, cursor: "pointer" };
const successBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" };
const errorBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
