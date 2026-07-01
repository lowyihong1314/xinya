export type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

const RFC_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function parseCalendarDateParts(value?: string | null): CalendarDateParts | null {
  if (!value) {
    return null;
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return normalizeDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const rfcMatch = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
  if (rfcMatch) {
    return normalizeDateParts(Number(rfcMatch[3]), RFC_MONTHS[rfcMatch[2].toLowerCase()], Number(rfcMatch[1]));
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return normalizeDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

export function calendarDateFromParts(parts: CalendarDateParts) {
  return new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
}

export function calendarDateKey(parts: CalendarDateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function normalizeDateParts(year: number, month: number, day: number): CalendarDateParts | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const normalized = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    normalized.getFullYear() !== year
    || normalized.getMonth() + 1 !== month
    || normalized.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}
