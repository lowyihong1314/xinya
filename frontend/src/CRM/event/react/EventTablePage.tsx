import { useNavigate, useSearchParams } from "react-router-dom";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { useEventTableController } from "./useEventTableController";
import { EventTableView } from "./EventTableView";
import { hasUserPermission } from "../../../app/permissions";

const DEFAULT_EVENT_TAB = "settings";

export function EventTablePage() {
  useEnsureDesignTokens();

  const { isMobile, user } = useUserState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawEventId = searchParams.get("event_id");
  const selectedEventId =
    rawEventId && Number.isFinite(Number(rawEventId)) && Number(rawEventId) > 0
      ? Number(rawEventId)
      : null;
  const activeTab = searchParams.get("event_tab") || DEFAULT_EVENT_TAB;
  // 佛学班入口：?event_type=buddhist → 只显示两种佛学班。
  const buddhistOnly = searchParams.get("event_type") === "buddhist";

  const { state, actions } = useEventTableController({ preferredEventId: selectedEventId, buddhistOnly });
  const canEditEvent = hasUserPermission(user, "event_edit");

  function selectEvent(eventId: number) {
    const next = new URLSearchParams(searchParams);
    next.set("event_id", String(eventId));
    if (!next.get("event_tab")) next.set("event_tab", DEFAULT_EVENT_TAB);
    setSearchParams(next);
  }

  function backToList() {
    const next = new URLSearchParams(searchParams);
    next.delete("event_id");
    next.delete("event_tab");
    setSearchParams(next);
  }

  function selectTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set("event_tab", tab);
    setSearchParams(next);
  }

  return (
    <EventTableView
      isMobile={isMobile}
      canEditEvent={canEditEvent}
      events={state.filteredEvents}
      forms={state.forms}
      selectedEvent={state.selectedEvent}
      selectedEventId={selectedEventId}
      selectedEventForm={state.selectedEventForm}
      activeTab={activeTab}
      query={state.query}
      selectedType={state.selectedType}
      eventTypeOptions={state.eventTypeOptions}
      buddhistOnly={state.buddhistOnly}
      showYouth={state.showYouth}
      showChildren={state.showChildren}
      onToggleYouth={actions.setShowYouth}
      onToggleChildren={actions.setShowChildren}
      loading={state.loading}
      creating={state.creating}
      posterUploading={state.uploadingPoster}
      brochureUploading={state.uploadingBrochure}
      attachmentUploading={state.uploadingEventFile}
      toast={state.toast}
      imageUrl={state.imageUrl}
      onQueryChange={actions.setQuery}
      onTypeChange={actions.setSelectedType}
      onSelectEvent={selectEvent}
      onBackToList={backToList}
      onSelectTab={selectTab}
      onRefresh={() => void actions.loadEvents()}
      onAddOrganizers={() => void actions.addOrganizers()}
      onCreateEvent={async (payload, media) => {
        const id = await actions.createNewEvent(payload, media);
        if (id) selectEvent(id);
        return Boolean(id);
      }}
      onUpdateEvent={(patch) => void actions.updateEvent(patch)}
      onUploadPoster={(file) => void actions.uploadPoster(file)}
      onUploadBrochure={(file) => void actions.uploadBrochure(file)}
      onRemoveBrochure={() => void actions.removeBrochure()}
      onUploadAttachment={(files) => void actions.uploadAttachment(files)}
      onRemoveAttachment={(fileId) => void actions.removeAttachment(fileId)}
      onDeleteEvent={() => {
        void actions.removeSelectedEvent().then((ok) => {
          if (ok) backToList();
        });
      }}
      onOpenFormContent={(formId) => navigate(`/crm/register?form_id=${formId}`)}
    />
  );
}
