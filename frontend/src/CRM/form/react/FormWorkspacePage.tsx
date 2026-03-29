import { ensureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { getUserPermissionNames } from "../../../app/permissions";
import { useFormWorkspace } from "./useFormWorkspace";
import { FormWorkspaceView } from "./FormWorkspaceView";

export function FormWorkspacePage() {
  ensureDesignTokens();

  const { user, isMobile } = useUserState();
  const permissionNames = getUserPermissionNames(user);
  const canReadForms =
    permissionNames.has("form_read") ||
    permissionNames.has("form_edit") ||
    permissionNames.has("member_detail");
  const canEditForms = permissionNames.has("form_edit");
  const canViewMemberDetail = canEditForms || permissionNames.has("member_detail");
  const { state, actions } = useFormWorkspace({
    enabled: canReadForms,
    canEditMembers: canEditForms,
  });

  return (
    <FormWorkspaceView
      canReadForms={canReadForms}
      canEditForms={canEditForms}
      canViewMemberDetail={canViewMemberDetail}
      canEditMembers={canEditForms}
      forms={state.forms}
      selectedForm={state.selectedForm}
      fees={state.fees}
      extraFields={state.extraFields}
      loading={state.loading}
      detailLoading={state.detailLoading}
      createOpen={state.createOpen}
      toast={state.toast}
      realtimeEnabled={state.realtimeEnabled}
      isMobile={isMobile}
      onOpenForm={(formId) => void actions.openForm(formId)}
      onOpenCreate={() => actions.setCreateOpen(true)}
      onCloseCreate={() => actions.setCreateOpen(false)}
      onCreateForm={(payload) => void actions.handleCreateForm(payload)}
      onDeleteForm={(formId) => void actions.handleDeleteForm(formId)}
      onPatchForm={(patch) => void actions.patchSelectedForm(patch)}
      onAddFee={(payload) => void actions.handleAddFee(payload)}
      onEditFee={(feeId, payload) => void actions.handleEditFee(feeId, payload)}
      onDeleteFee={(feeId) => void actions.handleDeleteFee(feeId)}
      onAddExtraField={(payload) => void actions.handleAddExtraField(payload)}
      onEditExtraField={(fieldId, payload) => void actions.handleEditExtraField(fieldId, payload)}
      onDeleteExtraField={(fieldId) => void actions.handleDeleteExtraField(fieldId)}
      onPickEvent={() => void actions.handlePickEvent()}
      onRemoveEvent={(eventId) => void actions.handleRemoveEvent(eventId)}
      onRemoveMember={(memberId) => void actions.handleRemoveMember(memberId)}
      onShowMemberDetail={(member) => actions.handleShowMemberDetail(member)}
      onOpenParental={(member) => void actions.handleOpenParental(member)}
      onRefresh={() => void actions.refreshSelectedForm()}
      onToggleRealtime={actions.setRealtime}
    />
  );
}
