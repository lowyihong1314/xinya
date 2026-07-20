import type { CSSProperties } from "react";

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir } | null;

/** Toggle sort state when a header is clicked: same key flips dir, new key starts asc. */
export function toggleSort(current: SortState, key: string): SortState {
  if (current && current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: "asc" };
}

/** Arrow suffix for a header cell. */
export function sortArrow(sort: SortState, key: string): string {
  if (!sort || sort.key !== key) return " ↕";
  return sort.dir === "asc" ? " ▲" : " ▼";
}

/** Stable sort by an extracted comparable value; nulls sort last regardless of dir. */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  getValue: (row: T, key: string) => number | string | null | undefined,
): T[] {
  if (!sort) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = getValue(a.row, sort.key);
      const vb = getValue(b.row, sort.key);
      const aEmpty = va == null || va === "";
      const bEmpty = vb == null || vb === "";
      if (aEmpty && bEmpty) return a.index - b.index;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), "zh-Hans-CN", { numeric: true });
      }
      if (cmp === 0) return a.index - b.index;
      return cmp * factor;
    })
    .map((item) => item.row);
}

export const sortableThStyle: CSSProperties = { cursor: "pointer", userSelect: "none" };
