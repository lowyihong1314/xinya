import { ensureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { useEventTableController } from "./useEventTableController";
import { EventTableView } from "./EventTableView";

export function EventTablePage() {
  ensureDesignTokens();

  const { isMobile } = useUserState();
  const { state, actions } = useEventTableController();

  return (
    <EventTableView
      events={state.pagedEvents}
      totalResults={state.filteredEvents.length}
      selectedEvent={state.selectedEvent}
      selectedEventId={state.selectedEventId}
      query={state.query}
      page={state.page}
      totalPages={state.totalPages}
      loading={state.loading}
      saving={state.saving}
      creating={state.creating}
      brochureUploading={state.uploadingBrochure}
      toast={state.toast}
      realtimeEnabled={state.realtimeEnabled}
      imageUrl={state.imageUrl}
      isMobile={isMobile}
      onQueryChange={actions.setQuery}
      onPageChange={actions.setPage}
      onSelectEvent={actions.setSelectedEventId}
      onRefresh={() => void actions.loadEvents()}
      onToggleRealtime={actions.setRealtime}
      onAddOrganizers={() => void actions.addOrganizers()}
      onCreateEvent={(payload) => actions.createNewEvent(payload)}
      onUpdateEvent={(patch) => void actions.updateEvent(patch)}
      onUploadBrochure={(file) => void actions.uploadBrochure(file)}
      onRemoveBrochure={() => void actions.removeBrochure()}
      onDeleteEvent={() => void actions.removeSelectedEvent()}
    />
  );
}
