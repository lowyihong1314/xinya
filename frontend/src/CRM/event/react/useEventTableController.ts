import { startTransition, useEffect, useMemo, useState } from "react";

import { smartImageURL } from "../../../js/get_img";
import { useEventData } from "../../../event/shared/EventDataContext";
import { select_users_modal } from "../../select_users_modal";
import { createEvent, deleteEvent, deleteEventFile, saveEvent, uploadEventBrochure, uploadEventFile } from "./api";
import type { EventCreatePayload, EventMutationPayload, EventRecord } from "./types";
import { useEventTableRealtime } from "./useEventTableRealtime";

type Toast = { type: "success" | "error"; text: string } | null;
const PAGE_SIZE = 6;

export function useEventTableController() {
  const { events, loading, error, refreshEvents } = useEventData();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingBrochure, setUploadingBrochure] = useState(false);
  const [uploadingEventFile, setUploadingEventFile] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEventId((prev) => prev ?? events[0]?.id ?? null);
  }, [events]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!error) {
      return;
    }
    setToast({ type: "error", text: error });
  }, [error]);

  useEffect(() => {
    void loadSelectedImage();
  }, [selectedEventId, events]);

  useEventTableRealtime({
    enabled: realtimeEnabled,
    onRefresh: () => {
      void refreshEvents();
    },
  });

  const filteredEvents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return events;
    }

    return events.filter((event) => {
      const organizerText = (event.organizers || [])
        .map((organizer) => organizer.display_name || organizer.username || "")
        .join(" ")
        .toLowerCase();

      return (
        (event.event_name || "").toLowerCase().includes(keyword) ||
        (event.location || "").toLowerCase().includes(keyword) ||
        (event.type || "").toLowerCase().includes(keyword) ||
        (event.target || "").toLowerCase().includes(keyword) ||
        (event.brochure_name || "").toLowerCase().includes(keyword) ||
        organizerText.includes(keyword)
      );
    });
  }, [events, query]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE)),
    [filteredEvents.length],
  );

  const pagedEvents = useMemo(() => {
    const startIndex = (page - 1) * PAGE_SIZE;
    return filteredEvents.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredEvents, page]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  async function loadSelectedImage() {
    const next = events.find((event) => event.id === selectedEventId);
    if (!next?.event_image?.id) {
      setImageUrl(null);
      return;
    }
    try {
      const url = await smartImageURL(next.event_image.id, "base");
      setImageUrl(url || null);
    } catch {
      setImageUrl(null);
    }
  }

  async function updateEvent(patch: EventMutationPayload) {
    if (!selectedEventId) {
      return;
    }

    setSaving(true);
    try {
      const payload = await saveEvent({
        event_id: selectedEventId,
        ...patch,
      });
      if (payload.data) {
        await refreshEvents();
      }
      setToast({ type: "success", text: "活动已更新" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function addOrganizers() {
    if (!selectedEvent) {
      return;
    }
    const selectedIds = await select_users_modal(5);
    if (!selectedIds?.length) {
      return;
    }
    await updateEvent({ organizers: selectedEvent.organizers, organizers_ids: selectedIds });
  }

  async function createNewEvent(payload: EventCreatePayload) {
    setCreating(true);
    try {
      const response = await createEvent(payload);
      await refreshEvents();
      if (response.data?.id) {
        setSelectedEventId(response.data.id);
      }
      setQuery("");
      setPage(1);
      setToast({ type: "success", text: "活动已创建" });
      return true;
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function removeSelectedEvent() {
    if (!selectedEvent) {
      return;
    }
    if (!window.confirm(`确认删除活动「${selectedEvent.event_name || `#${selectedEvent.id}`}」？`)) {
      return;
    }

    try {
      await deleteEvent(selectedEvent.id);
      setSelectedEventId(null);
      await refreshEvents();
      setToast({ type: "success", text: "活动已删除" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
    }
  }

  async function uploadBrochure(file: File) {
    if (!selectedEventId) {
      return;
    }
    setUploadingBrochure(true);
    try {
      await uploadEventBrochure(selectedEventId, file);
      await refreshEvents();
      setToast({ type: "success", text: "简章已上传" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "上传失败" });
    } finally {
      setUploadingBrochure(false);
    }
  }

  async function removeBrochure() {
    if (!selectedEventId) {
      return;
    }
    setUploadingBrochure(true);
    try {
      await saveEvent({
        event_id: selectedEventId,
        brochure_path: null,
      });
      await refreshEvents();
      setToast({ type: "success", text: "简章已移除" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "移除失败" });
    } finally {
      setUploadingBrochure(false);
    }
  }

  async function uploadAttachment(file: File) {
    if (!selectedEventId) {
      return;
    }
    setUploadingEventFile(true);
    try {
      await uploadEventFile(selectedEventId, file);
      await refreshEvents();
      setToast({ type: "success", text: "活动附件已上传" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "上传失败" });
    } finally {
      setUploadingEventFile(false);
    }
  }

  async function removeAttachment(fileId: number) {
    if (!selectedEventId) {
      return;
    }
    try {
      await deleteEventFile(fileId);
      await refreshEvents();
      setToast({ type: "success", text: "活动附件已删除" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
    }
  }

  function setRealtime(nextValue: boolean) {
    startTransition(() => {
      setRealtimeEnabled(nextValue);
    });
  }

  return {
    state: {
      events,
      filteredEvents,
      pagedEvents,
      selectedEvent,
      selectedEventId,
      query,
      page,
      totalPages,
      loading,
      saving,
      creating,
      uploadingBrochure,
      uploadingEventFile,
      toast,
      realtimeEnabled,
      imageUrl,
    },
    actions: {
      setQuery,
      setPage,
      setSelectedEventId,
      loadEvents: refreshEvents,
      updateEvent,
      createNewEvent,
      removeSelectedEvent,
      uploadBrochure,
      removeBrochure,
      uploadAttachment,
      removeAttachment,
      addOrganizers,
      setRealtime,
    },
  };
}
