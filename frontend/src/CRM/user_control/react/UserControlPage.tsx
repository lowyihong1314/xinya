import { ensureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { useUserControlController } from "./useUserControlController";
import { UserControlView } from "./UserControlView";

export function UserControlPage() {
  ensureDesignTokens();

  const { isMobile } = useUserState();
  const { state, actions } = useUserControlController();

  return (
    <UserControlView
      departments={state.departments}
      selectedDepartment={state.selectedDepartment}
      selectedDepartmentId={state.selectedDepartmentId}
      departmentUsers={state.departmentUsers}
      filteredUsers={state.filteredUsers}
      allPermissions={state.allPermissions}
      selectedUser={state.selectedUser}
      search={state.search}
      loading={state.loading}
      toast={state.toast}
      isMobile={isMobile}
      userEditorOpen={state.userEditorOpen}
      newUserOpen={state.newUserOpen}
      permissionOpen={state.permissionOpen}
      onSelectDepartment={actions.setSelectedDepartmentId}
      onSearchChange={actions.setSearch}
      onRefresh={() => void actions.refresh()}
      onOpenUser={(userId) => void actions.openUserEditor(userId)}
      onOpenNewUser={actions.openNewUser}
      onCloseNewUser={actions.closeNewUser}
      onCreateUser={(payload) => void actions.createUser(payload)}
      onCreateDepartment={(name) => void actions.createDept(name)}
      onDeleteDepartment={(departmentId) => void actions.removeDept(departmentId)}
      onAttachUser={(departmentId, userId) => void actions.attachUser(departmentId, userId)}
      onDetachUser={(departmentId, userId) => void actions.detachUser(departmentId, userId)}
      onOpenPermissionEditor={actions.openPermissionEditor}
      onClosePermissionEditor={actions.closePermissionEditor}
      onSavePermissions={(departmentId, ids) => void actions.savePermissions(departmentId, ids)}
      onCloseUserEditor={actions.closeUserEditor}
      onSaveUser={(payload) => void actions.saveUser(payload)}
      onDeleteUser={(userId) => void actions.removeUser(userId)}
      onResetPassword={(userId) => void actions.doResetPassword(userId)}
    />
  );
}
