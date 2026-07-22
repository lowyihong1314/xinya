import type { PublicEvent, TimeSlot } from "./types";

export type FlowSlot = { key: string; title: string; startISO: string; endISO: string; label: string };

function fmtClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 依据活动 datetime + 各流程 minutes 累计，算出每个流程的开始/结束时段（对应旧 flow.js）。
export function computeEventFlowSlots(event?: PublicEvent | null): FlowSlot[] {
  const flows = (event?.event_flows || []).slice().sort((a, b) => (Number(a?.no) || 0) - (Number(b?.no) || 0));
  const start = event?.datetime ? new Date(event.datetime) : null;
  if (!start || Number.isNaN(start.getTime()) || !flows.length) return [];

  let cumulative = 0;
  const slots: FlowSlot[] = [];
  flows.forEach((flow, index) => {
    const mins = Number(flow?.minutes) || 0;
    const rowStart = new Date(start.getTime() + cumulative * 60000);
    const rowEnd = new Date(rowStart.getTime() + mins * 60000);
    cumulative += mins;
    const title = String(flow?.title || `环节 ${index + 1}`);
    slots.push({
      key: `${index}`,
      title,
      startISO: rowStart.toISOString(),
      endISO: rowEnd.toISOString(),
      label: `${fmtClock(rowStart)} - ${fmtClock(rowEnd)} · ${title}`,
    });
  });
  return slots;
}

export function slotsToPayload(selected: FlowSlot[]): TimeSlot[] {
  return selected.map((s) => ({ datetime: s.startISO, end_datetime: s.endISO }));
}
