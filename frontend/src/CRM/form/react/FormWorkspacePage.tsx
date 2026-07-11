import { useNavigate, useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { getUserPermissionNames } from "../../../app/permissions";
import { useFormWorkspace } from "./useFormWorkspace";
import { FormWorkspaceView } from "./FormWorkspaceView";

const DEFAULT_FORM_TAB = "members";

export function FormWorkspacePage() {
  useEnsureDesignTokens();

  const { user, isMobile } = useUserState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissionNames = getUserPermissionNames(user);
  const canReadForms =
    permissionNames.has("form_read") ||
    permissionNames.has("form_edit") ||
    permissionNames.has("member_detail");
  const canEditForms = permissionNames.has("form_edit");
  const canViewMemberDetail = canEditForms || permissionNames.has("member_detail");

  const rawFormId = searchParams.get("form_id");
  const selectedFormId =
    rawFormId && Number.isFinite(Number(rawFormId)) && Number(rawFormId) > 0 ? Number(rawFormId) : null;
  const activeTab = searchParams.get("form_tab") || DEFAULT_FORM_TAB;

  const { state, actions } = useFormWorkspace({
    enabled: canReadForms,
    canEditMembers: canEditForms,
    preferredFormId: selectedFormId,
  });

  function selectForm(formId: number) {
    const next = new URLSearchParams(searchParams);
    next.set("form_id", String(formId));
    if (!next.get("form_tab")) next.set("form_tab", DEFAULT_FORM_TAB);
    setSearchParams(next);
  }

  function backToList() {
    const next = new URLSearchParams(searchParams);
    next.delete("form_id");
    next.delete("form_tab");
    setSearchParams(next);
  }

  function selectTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set("form_tab", tab);
    setSearchParams(next);
  }

  return (
    <FormWorkspaceView
      isMobile={isMobile}
      canReadForms={canReadForms}
      canEditForms={canEditForms}
      canViewMemberDetail={canViewMemberDetail}
      canEditMembers={canEditForms}
      forms={state.forms}
      selectedForm={state.selectedForm}
      selectedFormId={selectedFormId}
      activeTab={activeTab}
      fees={state.fees}
      extraFields={state.extraFields}
      loading={state.loading}
      detailLoading={state.detailLoading}
      createOpen={state.createOpen}
      toast={state.toast}
      onSelectForm={selectForm}
      onBackToList={backToList}
      onSelectTab={selectTab}
      onOpenCreate={() => actions.setCreateOpen(true)}
      onCloseCreate={() => actions.setCreateOpen(false)}
      onCreateForm={(payload) => void actions.handleCreateForm(payload)}
      onDeleteForm={(formId) => {
        void actions.handleDeleteForm(formId).then((deleted) => {
          if (deleted) backToList();
        });
      }}
      onPatchForm={(patch) => void actions.patchSelectedForm(patch)}
      onAddFee={(payload) => void actions.handleAddFee(payload)}
      onEditFee={(feeId, payload) => void actions.handleEditFee(feeId, payload)}
      onDeleteFee={(feeId) => void actions.handleDeleteFee(feeId)}
      onAddExtraField={(payload) => void actions.handleAddExtraField(payload)}
      onEditExtraField={(fieldId, payload) => void actions.handleEditExtraField(fieldId, payload)}
      onDeleteExtraField={(fieldId) => void actions.handleDeleteExtraField(fieldId)}
      onPickEvent={() => void actions.handlePickEvent()}
      onOpenEventDetail={(eventId) => navigate(`/crm/event_table?event_id=${eventId}`)}
      onRemoveEvent={(eventId) => void actions.handleRemoveEvent(eventId)}
      onRemoveMember={(memberId) => void actions.handleRemoveMember(memberId)}
      onShowMemberDetail={(member) => actions.handleShowMemberDetail(member)}
      onOpenParental={(member) => void actions.handleOpenParental(member)}
      onRefresh={() => void actions.refreshSelectedForm()}
    />
  );
}
