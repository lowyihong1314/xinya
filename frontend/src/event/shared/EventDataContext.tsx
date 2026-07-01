import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { fetchAllEventsSorted } from "./api";
import { calendarDateFromParts, parseCalendarDateParts } from "./eventDate";
import type { SharedEventRecord } from "./types";

type EventDataContextValue = {
  events: SharedEventRecord[];
  loading: boolean;
  error: string | null;
  refreshEvents: () => Promise<void>;
  realtimeEnabled: boolean;
  setRealtimeEnabled: (nextValue: boolean) => void;
  getEventById: (eventId: number | string) => SharedEventRecord | null;
  getEventsForMonth: (year: number, month: number) => SharedEventRecord[];
};

const EventDataContext = createContext<EventDataContextValue | null>(null);

export function EventDataProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<SharedEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeEnabled, setRealtimeFlag] = useState(false);

  useEffect(() => {
    void refreshEvents();
  }, []);

  useEffect(() => {
    if (!realtimeEnabled) {
      return;
    }

    const channel = "shared:event-data";
    console.debug("[event-data] reserved realtime channel", channel);

    return () => {
      console.debug("[event-data] unsubscribe", channel);
    };
  }, [realtimeEnabled]);

  async function refreshEvents() {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchAllEventsSorted();
      setEvents(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取活动失败");
    } finally {
      setLoading(false);
    }
  }

  const value = useMemo<EventDataContextValue>(
    () => ({
      events,
      loading,
      error,
      refreshEvents,
      realtimeEnabled,
      setRealtimeEnabled: (nextValue) => {
        startTransition(() => {
          setRealtimeFlag(nextValue);
        });
      },
      getEventById: (eventId) => {
        const normalizedId = Number(eventId);
        return events.find((event) => event.id === normalizedId) ?? null;
      },
      getEventsForMonth: (year, month) =>
        events.filter((event) => overlapsMonth(event, year, month)),
    }),
    [events, loading, error, realtimeEnabled],
  );

  return <EventDataContext.Provider value={value}>{children}</EventDataContext.Provider>;
}

export function useEventData() {
  const context = useContext(EventDataContext);
  if (!context) {
    throw new Error("useEventData must be used within EventDataProvider");
  }
  return context;
}

function overlapsMonth(event: SharedEventRecord, year: number, month: number) {
  const startParts = parseCalendarDateParts(event.datetime);
  if (!startParts) {
    return false;
  }

  const endParts = parseCalendarDateParts(event.end_datetime) || startParts;
  const start = calendarDateFromParts(startParts);
  const parsedEnd = calendarDateFromParts(endParts);
  const end = parsedEnd < start ? start : parsedEnd;
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  return start <= monthEnd && end >= monthStart;
}
