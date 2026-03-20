import { ensureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { useFormWorkspace } from "./useFormWorkspace";
import { FormWorkspaceView } from "./FormWorkspaceView";

export function FormWorkspacePage() {
  ensureDesignTokens();

  const { isMobile } = useUserState();
  const { state, actions } = useFormWorkspace();

  return (
    <FormWorkspaceView
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
