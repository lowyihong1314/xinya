export const FIXED_EVENT_TYPES = ["佛曲分享会"];

export function buildEventTypeChoices(values: Array<string | null | undefined> = []) {
  const merged = new Set<string>(FIXED_EVENT_TYPES);
  values.forEach((value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      merged.add(normalized);
    }
  });
  return Array.from(merged).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}
