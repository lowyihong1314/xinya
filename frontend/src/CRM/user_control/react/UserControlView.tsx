import { useEffect, useMemo, useState } from "react";

import { showPromptDialog } from "../../../js/dialogs";
import { NewUserModal } from "./view/NewUserModal";
import { PermissionModal } from "./view/PermissionModal";
import { UserEditorPage } from "./view/UserEditorPage";
import { UserCard } from "./view/UserCard";
import * as styles from "./view/styles";
import type { UserControlViewProps } from "./view/types";

const ALL_USERS_PAGE_SIZE_DESKTOP = 10;
const ALL_USERS_PAGE_SIZE_MOBILE = 8;
const DEPARTMENT_USERS_PAGE_SIZE = 8;

export function UserControlView(props: UserControlViewProps) {
  const isMobile = props.isMobile ?? false;
  const selectedDepartment = props.selectedDepartment;
  const selectedUser = props.selectedUser;
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [departmentUsersPage, setDepartmentUsersPage] = useState(1);
  const [allUsersPage, setAllUsersPage] = useState(1);

  const departmentUsersPageCount = Math.max(
    1,
    Math.ceil(props.departmentUsers.length / DEPARTMENT_USERS_PAGE_SIZE),
  );
  const safeDepartmentUsersPage = Math.min(
    departmentUsersPage,
    departmentUsersPageCount,
  );
  const pagedDepartmentUsers = useMemo(
    () =>
      props.departmentUsers.slice(
        (safeDepartmentUsersPage - 1) * DEPARTMENT_USERS_PAGE_SIZE,
        safeDepartmentUsersPage * DEPARTMENT_USERS_PAGE_SIZE,
      ),
    [props.departmentUsers, safeDepartmentUsersPage],
  );

  const allUsersPageSize = isMobile
    ? ALL_USERS_PAGE_SIZE_MOBILE
    : ALL_USERS_PAGE_SIZE_DESKTOP;
  const allUsersPageCount = Math.max(
    1,
    Math.ceil(props.filteredUsers.length / allUsersPageSize),
  );
  const safeAllUsersPage = Math.min(allUsersPage, allUsersPageCount);
  const pagedAllUsers = useMemo(
    () =>
      props.filteredUsers.slice(
        (safeAllUsersPage - 1) * allUsersPageSize,
        safeAllUsersPage * allUsersPageSize,
      ),
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

  async function handleRenameDepartment() {
    if (!selectedDepartment) {
      return;
    }

    const currentName = selectedDepartment.name || "";
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

    props.onRenameDepartment(selectedDepartment.id, trimmed);
  }

  return (
    <div style={styles.pageStyle}>
      <header style={styles.headerStyle}>
        <div>
          <div style={styles.eyebrowStyle}>User Control</div>
          <h3 style={styles.titleStyle}>
            {props.userEditorOpen && selectedUser ? "编辑用户" : "用户管理"}
          </h3>
        </div>
        <div style={styles.toolbarStyle(isMobile)}>
          {props.userEditorOpen && selectedUser ? (
            <button
              type="button"
              style={styles.secondaryButtonStyle}
              onClick={props.onCloseUserEditor}
            >
              返回列表
            </button>
          ) : (
            <button
              type="button"
              style={styles.primaryButtonStyle}
              onClick={props.onOpenNewUser}
            >
              新增用户
            </button>
          )}
        </div>
      </header>

      {props.toast ? (
        <div
          style={
            props.toast.type === "success"
              ? styles.successBannerStyle
              : styles.errorBannerStyle
          }
        >
          {props.toast.text}
        </div>
      ) : null}

      {props.userEditorOpen && selectedUser ? (
        <section style={styles.editorPageShellStyle}>
          <UserEditorPage
            user={selectedUser}
            onBack={props.onCloseUserEditor}
            onSave={props.onSaveUser}
            onDelete={() => props.onDeleteUser(selectedUser.id)}
            onResetPassword={() => props.onResetPassword(selectedUser.id)}
            onCreateRenewal={props.onCreateRenewal}
            onDeleteRenewal={props.onDeleteRenewal}
          />
        </section>
      ) : (
        <>
          <div style={styles.layoutStyle(isMobile)}>
            <section style={styles.departmentPanelStyle(isMobile)}>
              <div style={styles.panelHeaderStyle}>
                <div>
                  <div style={styles.sectionEyebrowStyle}>Departments</div>
                  <h4 style={styles.sectionTitleStyle}>部门</h4>
                </div>
              </div>

              <div style={styles.createRowStyle(isMobile)}>
                <input
                  style={styles.inputStyle}
                  value={newDepartmentName}
                  placeholder="新部门名称"
                  onChange={(event) => setNewDepartmentName(event.target.value)}
                />
                <button
                  type="button"
                  style={styles.secondaryButtonStyle}
                  onClick={() => {
                    const trimmed = newDepartmentName.trim();
                    if (!trimmed) {
                      return;
                    }
                    props.onCreateDepartment(trimmed);
                    setNewDepartmentName("");
                  }}
                >
                  添加
                </button>
              </div>

              <div style={styles.departmentListStyle}>
                {props.departments.map((department) => (
                  <button
                    key={department.id}
                    type="button"
                    style={styles.departmentCardStyle(
                      props.selectedDepartmentId === department.id,
                    )}
                    onClick={() => props.onSelectDepartment(department.id)}
                  >
                    <div style={styles.departmentTitleStyle}>
                      {department.name}
                    </div>
                    <div style={styles.departmentMetaStyle}>
                      {(department.permissions || []).length} 个权限
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section style={styles.departmentUsersPanelStyle}>
              <div style={styles.panelHeaderStyle}>
                <div>
                  <div style={styles.sectionEyebrowStyle}>Department Users</div>
                  <h4 style={styles.sectionTitleStyle}>
                    {selectedDepartment?.name || "未选择部门"}
                  </h4>
                </div>

                {selectedDepartment ? (
                  <div style={styles.toolbarStyle(isMobile)}>
                    <button
                      type="button"
                      style={styles.secondaryButtonStyle}
                      onClick={() => {
                        void handleRenameDepartment();
                      }}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      style={styles.secondaryButtonStyle}
                      onClick={props.onOpenPermissionEditor}
                    >
                      权限
                    </button>
                    <button
                      type="button"
                      style={styles.dangerButtonStyle}
                      onClick={() =>
                        props.onDeleteDepartment(selectedDepartment.id)
                      }
                    >
                      删除部门
                    </button>
                  </div>
                ) : null}
              </div>

              {props.loading ? (
                <div style={styles.placeholderStyle}>读取中…</div>
              ) : null}
              {!props.loading && !props.departmentUsers.length ? (
                <div style={styles.placeholderStyle}>该部门暂无成员</div>
              ) : null}

              {!props.loading && props.departmentUsers.length ? (
                <div style={styles.listSummaryStyle(isMobile)}>
                  <div style={styles.listMetaStyle}>
                    共 {props.departmentUsers.length} 人 · 第{" "}
                    {safeDepartmentUsersPage} / {departmentUsersPageCount} 页
                  </div>
                  <div style={styles.paginationActionsStyle}>
                    <button
                      type="button"
                      style={styles.paginationButtonStyle(
                        safeDepartmentUsersPage <= 1,
                      )}
                      onClick={() =>
                        setDepartmentUsersPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={safeDepartmentUsersPage <= 1}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      style={styles.paginationButtonStyle(
                        safeDepartmentUsersPage >= departmentUsersPageCount,
                      )}
                      onClick={() =>
                        setDepartmentUsersPage((prev) =>
                          Math.min(departmentUsersPageCount, prev + 1),
                        )
                      }
                      disabled={
                        safeDepartmentUsersPage >= departmentUsersPageCount
                      }
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}

              <div style={styles.cardGridStyle}>
                {pagedDepartmentUsers.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    actionLabel="移出"
                    actionTone="danger"
                    onOpen={() => props.onOpenUser(user.id)}
                    onAction={
                      selectedDepartment
                        ? () => props.onDetachUser(selectedDepartment.id, user.id)
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          </div>

          <section style={styles.panelStyle}>
            <div style={styles.panelHeaderStyle}>
              <div>
                <div style={styles.sectionEyebrowStyle}>All Users</div>
                <h4 style={styles.sectionTitleStyle}>成员</h4>
              </div>
              <input
                style={styles.searchStyle(isMobile)}
                value={props.search}
                placeholder="搜索姓名 / 用户名 / 邮箱 / 电话"
                onChange={(event) => props.onSearchChange(event.target.value)}
              />
            </div>

            <div style={styles.listSummaryStyle(isMobile)}>
              <div style={styles.listMetaStyle}>
                共 {props.filteredUsers.length} 人 · 第 {safeAllUsersPage} /{" "}
                {allUsersPageCount} 页
              </div>
              <div style={styles.paginationActionsStyle}>
                <button
                  type="button"
                  style={styles.paginationButtonStyle(safeAllUsersPage <= 1)}
                  onClick={() =>
                    setAllUsersPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={safeAllUsersPage <= 1}
                >
                  上一页
                </button>
                <button
                  type="button"
                  style={styles.paginationButtonStyle(
                    safeAllUsersPage >= allUsersPageCount,
                  )}
                  onClick={() =>
                    setAllUsersPage((prev) =>
                      Math.min(allUsersPageCount, prev + 1),
                    )
                  }
                  disabled={safeAllUsersPage >= allUsersPageCount}
                >
                  下一页
                </button>
              </div>
            </div>

            {!props.filteredUsers.length ? (
              <div style={styles.placeholderStyle}>没有匹配的成员</div>
            ) : null}

            <div style={styles.cardGridStyle}>
              {pagedAllUsers.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  actionLabel={selectedDepartment ? "加入部门" : undefined}
                  actionTone="default"
                  onOpen={() => props.onOpenUser(user.id)}
                  onAction={
                    selectedDepartment
                      ? () => props.onAttachUser(selectedDepartment.id, user.id)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>

          {props.newUserOpen ? (
            <NewUserModal
              onClose={props.onCloseNewUser}
              onSubmit={props.onCreateUser}
            />
          ) : null}
        </>
      )}

      {props.permissionOpen && selectedDepartment ? (
        <PermissionModal
          department={selectedDepartment}
          permissions={props.allPermissions}
          onClose={props.onClosePermissionEditor}
          onSave={(ids) => props.onSavePermissions(selectedDepartment.id, ids)}
        />
      ) : null}
    </div>
  );
}

export { UserCard } from "./view/UserCard";
