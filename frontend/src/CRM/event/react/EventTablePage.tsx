import { useNavigate } from "react-router-dom";

import { ensureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { useEventTableController } from "./useEventTableController";
import { EventTableView } from "./EventTableView";
import { hasUserPermission } from "../../../app/permissions";

export function EventTablePage() {
  ensureDesignTokens();

  const { isMobile, user } = useUserState();
  const navigate = useNavigate();
  const { state, actions } = useEventTableController();
  const canEditEvent = hasUserPermission(user, "event_edit");

  return (
    <EventTableView
      events={state.pagedEvents}
      totalResults={state.filteredEvents.length}
      selectedEvent={state.selectedEvent}
      selectedEventId={state.selectedEventId}
      selectedEventForm={state.selectedEventForm}
      query={state.query}
      selectedType={state.selectedType}
      eventTypeOptions={state.eventTypeOptions}
      page={state.page}
      totalPages={state.totalPages}
      loading={state.loading}
      saving={state.saving}
      creating={state.creating}
      brochureUploading={state.uploadingBrochure}
      attachmentUploading={state.uploadingEventFile}
      toast={state.toast}
      realtimeEnabled={state.realtimeEnabled}
      imageUrl={state.imageUrl}
      isMobile={isMobile}
      canEditEvent={canEditEvent}
      onQueryChange={actions.setQuery}
      onTypeChange={actions.setSelectedType}
      onPageChange={actions.setPage}
      onSelectEvent={actions.setSelectedEventId}
      onRefresh={() => void actions.loadEvents()}
      onToggleRealtime={actions.setRealtime}
      onAddOrganizers={() => void actions.addOrganizers()}
      onCreateEvent={(payload) => actions.createNewEvent(payload)}
      onUpdateEvent={(patch) => void actions.updateEvent(patch)}
      onUploadBrochure={(file) => void actions.uploadBrochure(file)}
      onRemoveBrochure={() => void actions.removeBrochure()}
      onUploadAttachment={(file) => void actions.uploadAttachment(file)}
      onRemoveAttachment={(fileId) => void actions.removeAttachment(fileId)}
      onDeleteEvent={() => void actions.removeSelectedEvent()}
      onOpenFormContent={(formId) => navigate(`/crm/register?form_id=${formId}`)}
    />
  );
}
