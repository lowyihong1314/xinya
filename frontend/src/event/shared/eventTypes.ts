export const FIXED_EVENT_TYPES = ["佛曲分享会", "青少年佛学班", "儿童佛学班"];

// 佛学班的两个子类型（用于列表筛选：默认隐藏，或佛学班入口只显示这些）。
export const BUDDHIST_CLASS_TYPES = ["青少年佛学班", "儿童佛学班"];

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
