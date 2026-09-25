import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

export const TABLE_PAGE_SIZE = 15;

// 所有列表统一可选的「每页条数」。
export const PAGE_SIZE_OPTIONS = [8, 10, 15, 20] as const;

// 用户选过的每页条数记在浏览器里，各个列表共用同一个偏好。
const PAGE_SIZE_STORAGE_KEY = "x.tablePageSize";

function readStoredPageSize(): number | null {
  try {
    const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const value = raw ? Number(raw) : NaN;
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredPageSize(value: number) {
  try {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(value));
  } catch {
    // 无痕模式等情况下写不进去也没关系，只影响记忆偏好。
  }
}

// 「每页条数」偏好：默认用调用方给的值，用户一旦手动选过就以选择为准。
// 给没有走 usePagedRows、自己管理分页的列表用。
export function usePageSizeChoice(defaultPageSize: number = TABLE_PAGE_SIZE): [number, (size: number) => void] {
  const [override, setOverride] = useState<number | null>(readStoredPageSize);
  const setPageSize = useCallback((size: number) => {
    if (!(PAGE_SIZE_OPTIONS as readonly number[]).includes(size)) return;
    setOverride(size);
    writeStoredPageSize(size);
  }, []);
  return [override ?? defaultPageSize, setPageSize];
}

// 通用表格分页：默认一页 15 条，页码按钮显示在表格上方，可切换每页条数。
export function usePagedRows<T>(rows: T[], pageSize: number = TABLE_PAGE_SIZE, resetKey?: unknown) {
  const [page, setPage] = useState(1);
  const [effectivePageSize, setChosenPageSize] = usePageSizeChoice(pageSize);

  // 过滤条件变化时回到第一页。
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const setPageSize = useCallback(
    (size: number) => {
      setChosenPageSize(size);
      setPage(1);
    },
    [setChosenPageSize],
  );

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pageRows = rows.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  return { page: safePage, setPage, totalPages, total, pageRows, pageSize: effectivePageSize, setPageSize };
}

function pageWindow(current: number, totalPages: number): (number | "…")[] {
  const pages: (number | "…")[] = [];
  const first = 1;
  const last = totalPages;
  const start = Math.max(first, current - 1);
  const end = Math.min(last, current + 1);

  pages.push(first);
  if (start > first + 1) pages.push("…");
  for (let p = Math.max(first + 1, start); p <= Math.min(last - 1, end); p += 1) pages.push(p);
  if (end < last - 1) pages.push("…");
  if (last > first) pages.push(last);
  return pages;
}

// 每页条数切换按钮组（8 / 10 / 15 / 20 条/页）。
export function PageSizePicker({ pageSize, onPageSize }: { pageSize: number; onPageSize: (size: number) => void }) {
  return (
    <div style={sizeGroupStyle} role="group" aria-label="每页条数">
      {PAGE_SIZE_OPTIONS.map((size) => (
        <button
          key={size}
          type="button"
          aria-pressed={size === pageSize}
          style={size === pageSize ? activeSizeBtnStyle : sizeBtnStyle}
          onClick={() => onPageSize(size)}
        >
          {size}
        </button>
      ))}
      <span style={sizeLabelStyle}>条/页</span>
    </div>
  );
}

export function TablePagination({
  page,
  totalPages,
  total,
  onPage,
  pageSize,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  // 传入这两个就会显示「条/页」切换按钮。
  pageSize?: number;
  onPageSize?: (size: number) => void;
}) {
  if (total === 0) return null;
  const pages = pageWindow(page, totalPages);
  const showSizePicker = typeof pageSize === "number" && typeof onPageSize === "function";
  return (
    <div style={barStyle}>
      <div style={leftStyle}>
        <span style={metaStyle}>
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
        {showSizePicker ? <PageSizePicker pageSize={pageSize} onPageSize={onPageSize} /> : null}
      </div>
      {totalPages > 1 ? (
        <div style={rowStyle}>
          <button type="button" style={navBtnStyle} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ‹
          </button>
          {pages.map((p, index) =>
            p === "…" ? (
              <span key={`gap-${index}`} style={ellipsisStyle}>
                …
              </span>
            ) : (
              <button key={p} type="button" style={p === page ? activePageStyle : pageBtnStyle} onClick={() => onPage(p)}>
                {p}
              </button>
            ),
          )}
          <button type="button" style={navBtnStyle} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  flexWrap: "wrap",
  padding: "2px 0 10px",
};

const leftStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const metaStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 600 };

const rowStyle: CSSProperties = { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" };

const pageBtnStyle: CSSProperties = {
  minWidth: "30px",
  height: "30px",
  padding: "0 8px",
  borderRadius: "7px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "12.5px",
  fontWeight: 700,
  cursor: "pointer",
};

const activePageStyle: CSSProperties = {
  ...pageBtnStyle,
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent)",
  color: "#fff",
};

const navBtnStyle: CSSProperties = {
  ...pageBtnStyle,
  fontSize: "15px",
  lineHeight: 1,
};

const ellipsisStyle: CSSProperties = { padding: "0 4px", color: "var(--x-color-ink-muted)", fontWeight: 700 };

const sizeGroupStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "3px" };

const sizeBtnStyle: CSSProperties = {
  minWidth: "28px",
  height: "26px",
  padding: "0 6px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
};

const activeSizeBtnStyle: CSSProperties = {
  ...sizeBtnStyle,
  border: "1px solid var(--x-color-accent-strong)",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
};

const sizeLabelStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginLeft: "3px" };
