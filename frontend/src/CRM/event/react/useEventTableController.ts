import { startTransition, useEffect, useMemo, useState } from "react";

import { smartImageURL } from "../../../js/get_img";
import { showConfirmDialog } from "../../../js/dialogs";
import { useEventData } from "../../../event/shared/EventDataContext";
import { buildEventTypeChoices } from "../../../event/shared/eventTypes";
import { useDebouncedAutosave } from "../../shared/useDebouncedAutosave";
import { select_users_modal } from "../../select_users_modal";
import { fetchForms } from "../../form/react/api";
import type { FormRecord } from "../../form/react/types";
import {
  createEvent,
  deleteEvent,
  deleteEventFile,
  saveEvent,
  uploadEventBrochure,
  uploadEventFile,
  uploadEventPoster,
} from "./api";
import type { EventCreatePayload, EventMutationPayload, EventRecord } from "./types";
import { useEventTableRealtime } from "./useEventTableRealtime";

type Toast = { type: "success" | "error"; text: string } | null;
const ALL_EVENT_TYPE_FILTER = "__all__";
const BLANK_EVENT_TYPE_FILTER = "__blank__";
const EVENT_EDITOR_DEBOUNCE_MS = 600;

export function useEventTableController(options?: { preferredEventId?: number | null }) {
  const preferredEventId = options?.preferredEventId ?? null;
  const { events, loading, error, refreshEvents } = useEventData();
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState(ALL_EVENT_TYPE_FILTER);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadingBrochure, setUploadingBrochure] = useState(false);
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const [uploadingEventFile, setUploadingEventFile] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [eventDrafts, setEventDrafts] = useState<Record<number, EventMutationPayload>>({});

  const mergedEvents = useMemo(
    () =>
      events.map((event) =>
        eventDrafts[event.id]
          ? {
              ...event,
              ...eventDrafts[event.id],
            }
          : event,
      ),
    [eventDrafts, events],
  );

  const autosave = useDebouncedAutosave<number, EventMutationPayload>({
    debounceMs: EVENT_EDITOR_DEBOUNCE_MS,
    mergePatch: (current, next) => ({
      ...current,
      ...next,
    }),
    persist: async (eventId, patch) => {
      await persistEventPatch(eventId, patch);
      setToast({ type: "success", text: "活动已更新" });
    },
    onError: (err) => {
      setToast({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
    },
  });

  // 选中项完全由 URL 的 ?event_id= 驱动：有就选中，没有就回到列表（不自动选第一个）。
  useEffect(() => {
    setSelectedEventId(
      preferredEventId && mergedEvents.some((event) => event.id === preferredEventId)
        ? preferredEventId
        : null,
    );
  }, [mergedEvents, preferredEventId]);

  // 切换活动时先把未保存的字段编辑 flush 掉。
  useEffect(() => {
    void autosave.flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredEventId]);

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

  useEffect(() => {
    void loadLinkedForms();
  }, []);

  useEventTableRealtime({
    enabled: realtimeEnabled,
    onRefresh: () => {
      void refreshEventRows();
    },
  });

  const eventTypeOptions = useMemo(() => {
    const values = buildEventTypeChoices(mergedEvents.map((event) => event.type));

    const hasBlank = mergedEvents.some((event) => !String(event.type || "").trim());
    return [
      { value: ALL_EVENT_TYPE_FILTER, label: "全部类型" },
      ...(hasBlank ? [{ value: BLANK_EVENT_TYPE_FILTER, label: "未设置类型" }] : []),
      ...values.map((value) => ({ value, label: value })),
    ];
  }, [mergedEvents]);

  useEffect(() => {
    if (eventTypeOptions.some((option) => option.value === selectedType)) {
      return;
    }
    setSelectedType(ALL_EVENT_TYPE_FILTER);
  }, [eventTypeOptions, selectedType]);

  const filteredEvents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return mergedEvents.filter((event) => {
      const eventType = String(event.type || "").trim();
      const typeMatched =
        selectedType === ALL_EVENT_TYPE_FILTER
          ? true
          : selectedType === BLANK_EVENT_TYPE_FILTER
            ? !eventType
            : eventType === selectedType;
      if (!typeMatched) {
        return false;
      }
      if (!keyword) {
        return true;
      }
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
  }, [mergedEvents, query, selectedType]);

  const selectedEvent = useMemo(
    () => mergedEvents.find((event) => event.id === selectedEventId) ?? null,
    [mergedEvents, selectedEventId],
  );
  const selectedEventForm = useMemo(() => {
    if (!selectedEvent) {
      return null;
    }
    return (
      forms.find((form) =>
        form.event_id === selectedEvent.id
        || form.event?.id === selectedEvent.id
        || Boolean(form.events?.some((event) => event.id === selectedEvent.id))) ?? null
    );
  }, [forms, selectedEvent]);

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

  async function loadLinkedForms() {
    try {
      const payload = await fetchForms();
      setForms(Array.isArray(payload.forms) ? payload.forms : []);
    } catch (error) {
      console.warn("Failed to load linked registration forms", error);
      setForms([]);
    }
  }

  function applyLocalEventPatch(eventId: number, patch: EventMutationPayload) {
    setEventDrafts((prev) => ({
      ...prev,
      [eventId]: {
        ...(prev[eventId] || {}),
        ...patch,
      },
    }));
  }

  function clearLocalEventPatch(eventId?: number) {
    setEventDrafts((prev) => {
      if (eventId === undefined) {
        return Object.keys(prev).length ? {} : prev;
      }
      if (!(eventId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  }

  async function persistEventPatch(eventId: number, patch: EventMutationPayload) {
    setSaving(true);
    try {
      await saveEvent({
        event_id: eventId,
        ...patch,
      });
      await refreshEvents();
      clearLocalEventPatch(eventId);
    } finally {
      setSaving(false);
    }
  }

  async function flushPendingEventChanges() {
    await autosave.flush();
  }

  async function refreshEventRows() {
    const hadPendingChanges = autosave.hasPending();
    await flushPendingEventChanges();
    if (!hadPendingChanges) {
      await refreshEvents();
    }
  }

  async function loadEvents() {
    const hadPendingChanges = autosave.hasPending();
    await flushPendingEventChanges();
    await Promise.all([hadPendingChanges ? Promise.resolve() : refreshEvents(), loadLinkedForms()]);
  }

  function updateEvent(patch: EventMutationPayload) {
    if (!selectedEventId) {
      return;
    }
    applyLocalEventPatch(selectedEventId, patch);
    autosave.schedule(selectedEventId, patch);
  }

  async function addOrganizers() {
    if (!selectedEvent) {
      return;
    }
    const selectedIds = await select_users_modal(5);
    if (!selectedIds?.length) {
      return;
    }
    await flushPendingEventChanges();
    try {
      await persistEventPatch(selectedEvent.id, { organizers: selectedEvent.organizers, organizers_ids: selectedIds });
      setToast({ type: "success", text: "活动已更新" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
    }
  }

  async function createNewEvent(payload: EventCreatePayload) {
    await flushPendingEventChanges();
    setCreating(true);
    try {
      const response = await createEvent(payload);
      await refreshEvents();
      setQuery("");
      setToast({ type: "success", text: "活动已创建" });
      return response.data?.id ?? null;
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "创建失败" });
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function removeSelectedEvent() {
    if (!selectedEvent) {
      return false;
    }
    if (!(await showConfirmDialog({
      message: `确认删除活动「${selectedEvent.event_name || `#${selectedEvent.id}`}」？`,
      tone: "danger",
    }))) {
      return false;
    }

    try {
      await flushPendingEventChanges();
      await deleteEvent(selectedEvent.id);
      clearLocalEventPatch(selectedEvent.id);
      setSelectedEventId(null);
      await refreshEvents();
      setToast({ type: "success", text: "活动已删除" });
      return true;
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
      return false;
    }
  }

  async function uploadBrochure(file: File) {
    if (!selectedEventId) {
      return;
    }
    await flushPendingEventChanges();
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

  async function uploadPoster(file: File) {
    if (!selectedEventId) {
      return;
    }
    await flushPendingEventChanges();
    setUploadingPoster(true);
    try {
      await uploadEventPoster(selectedEventId, file);
      await refreshEvents();
      setToast({ type: "success", text: "活动海报已上传并切换" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "海报上传失败" });
    } finally {
      setUploadingPoster(false);
    }
  }

  async function removeBrochure() {
    if (!selectedEventId) {
      return;
    }
    await flushPendingEventChanges();
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

  async function uploadAttachment(files: File | File[]) {
    if (!selectedEventId) {
      return;
    }
    const uploadFiles = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (!uploadFiles.length) {
      return;
    }

    await flushPendingEventChanges();
    setUploadingEventFile(true);
    let successCount = 0;
    const failedNames: string[] = [];
    try {
      for (const file of uploadFiles) {
        try {
          await uploadEventFile(selectedEventId, file);
          successCount += 1;
        } catch (err) {
          failedNames.push(`${file.name || "未命名文件"}：${err instanceof Error ? err.message : "上传失败"}`);
        }
      }
      if (successCount) {
        await refreshEvents();
      }
      if (failedNames.length) {
        setToast({
          type: "error",
          text: `已上传 ${successCount} 个，失败 ${failedNames.length} 个：${failedNames.slice(0, 2).join("；")}`,
        });
      } else {
        setToast({ type: "success", text: uploadFiles.length > 1 ? `已上传 ${successCount} 个活动附件` : "活动附件已上传" });
      }
    } finally {
      setUploadingEventFile(false);
    }
  }

  async function removeAttachment(fileId: number) {
    if (!selectedEventId) {
      return;
    }
    await flushPendingEventChanges();
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
      events: mergedEvents,
      filteredEvents,
      forms,
      selectedEvent,
      selectedEventId,
      selectedEventForm,
      query,
      selectedType,
      eventTypeOptions,
      loading,
      saving,
      creating,
      uploadingBrochure,
      uploadingPoster,
      uploadingEventFile,
      toast,
      realtimeEnabled,
      imageUrl,
    },
    actions: {
      setQuery,
      setSelectedType,
      loadEvents,
      updateEvent,
      createNewEvent,
      removeSelectedEvent,
      uploadPoster,
      uploadBrochure,
      removeBrochure,
      uploadAttachment,
      removeAttachment,
      addOrganizers,
      setRealtime,
    },
  };
}
