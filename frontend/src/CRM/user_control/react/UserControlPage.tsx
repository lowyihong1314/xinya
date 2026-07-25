import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { useUserControlController } from "./useUserControlController";
import { DepartmentsView } from "./DepartmentsView";
import { MembersView } from "./MembersView";
import { PermissionsView } from "./PermissionsView";
import { NewUserModal } from "./view/NewUserModal";
import { PermissionModal } from "./view/PermissionModal";
import * as styles from "./view/styles";

export function UserControlPage() {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, actions } = useUserControlController();

  const rawView = searchParams.get("user_control_view");
  const view =
    rawView === "departments" ? "departments" : rawView === "permissions" ? "permissions" : "members";
  const userIdParam = searchParams.get("user_id");
  const deptIdParam = searchParams.get("dept_id");
  const permIdParam = searchParams.get("permission_id");
  const selectedPermissionId =
    view === "permissions" && permIdParam && Number.isFinite(Number(permIdParam))
      ? Number(permIdParam)
      : null;
  const editorUserId =
    view === "members" && userIdParam && Number.isFinite(Number(userIdParam))
      ? Number(userIdParam)
      : null;
  const deptId =
    view === "departments" && deptIdParam && Number.isFinite(Number(deptIdParam))
      ? Number(deptIdParam)
      : null;

  // 用户管理：根据 ?user_id= 载入 / 关闭用户详情，刷新后仍保留。
  useEffect(() => {
    if (view !== "members") {
      return;
    }
    if (editorUserId !== null && editorUserId > 0) {
      void actions.openUserEditor(editorUserId);
    } else {
      actions.closeUserEditor();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, editorUserId]);

  // 部门管理：根据 ?dept_id= 选中部门，刷新后仍保留。
  useEffect(() => {
    if (view !== "departments" || deptId === null || deptId <= 0) {
      return;
    }
    actions.setSelectedDepartmentId(deptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, deptId]);

  function setParam(key: string, value: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      },
      { replace: false },
    );
  }

  return (
    <div style={styles.pageStyle}>
      <header style={styles.headerStyle}>
        <div>
          <div style={styles.eyebrowStyle}>User Control</div>
          <h3 style={styles.titleStyle}>
            {view === "departments" ? "部门管理" : view === "permissions" ? "权限管理" : "用户管理"}
          </h3>
        </div>
      </header>

      {state.toast ? (
        <div
          style={
            state.toast.type === "success"
              ? styles.successBannerStyle
              : styles.errorBannerStyle
          }
        >
          {state.toast.text}
        </div>
      ) : null}

      {view === "departments" ? (
        <DepartmentsView
          isMobile={isMobile}
          departments={state.departments}
          selectedDepartmentId={state.selectedDepartmentId}
          selectedDepartment={state.selectedDepartment}
          departmentUsers={state.departmentUsers}
          loading={state.loading}
          onRefresh={() => void actions.refresh()}
          onSelectDept={(id) => {
            actions.setSelectedDepartmentId(id);
            setParam("dept_id", String(id));
          }}
          onCreateDept={(name) => void actions.createDept(name)}
          onRenameDept={(id, name) => void actions.renameDept(id, name)}
          onDeleteDept={(id) => {
            void actions.removeDept(id);
            actions.setSelectedDepartmentId(null);
            setParam("dept_id", null);
          }}
          onOpenPermissionEditor={actions.openPermissionEditor}
          onAttachUser={actions.attachUser}
          onDetachUser={actions.detachUser}
        />
      ) : view === "permissions" ? (
        <PermissionsView
          isMobile={isMobile}
          permissions={state.allPermissions}
          departments={state.departments}
          users={state.allUsers}
          loading={state.loading}
          selectedPermissionId={selectedPermissionId}
          onSelectPermission={(id) => setParam("permission_id", String(id))}
          onRefresh={() => void actions.refresh()}
          onSavePermissions={(deptId, nextIds) => void actions.savePermissions(deptId, nextIds)}
        />
      ) : (
        <MembersView
          isMobile={isMobile}
          users={state.filteredUsers}
          search={state.search}
          loading={state.loading}
          editorUserId={editorUserId}
          selectedUser={state.selectedUser}
          onSearchChange={actions.setSearch}
          onRefresh={() => void actions.refresh()}
          onOpenNewUser={actions.openNewUser}
          onOpenUser={(id) => setParam("user_id", String(id))}
          onCloseUser={() => setParam("user_id", null)}
          onSaveUser={(payload) => void actions.saveUser(payload)}
          onDeleteUser={(id) => {
            void actions.removeUser(id);
            setParam("user_id", null);
          }}
          onResetPassword={(id) => void actions.doResetPassword(id)}
          onCreateRenewal={(payload) => void actions.addRenewal(payload)}
          onDeleteRenewal={(id) => void actions.removeRenewal(id)}
        />
      )}

      {state.newUserOpen ? (
        <NewUserModal
          onClose={actions.closeNewUser}
          onSubmit={(payload) => void actions.createUser(payload)}
        />
      ) : null}

      {state.permissionOpen && state.selectedDepartment ? (
        <PermissionModal
          department={state.selectedDepartment}
          permissions={state.allPermissions}
          onClose={actions.closePermissionEditor}
          onSave={(ids) =>
            void actions.savePermissions(state.selectedDepartment!.id, ids)
          }
        />
      ) : null}
    </div>
  );
}
