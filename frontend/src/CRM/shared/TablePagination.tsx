import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export const TABLE_PAGE_SIZE = 15;

// 通用表格分页：一页 15 条，页码按钮显示在表格上方。
export function usePagedRows<T>(rows: T[], pageSize: number = TABLE_PAGE_SIZE, resetKey?: unknown) {
  const [page, setPage] = useState(1);

  // 过滤条件变化时回到第一页。
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { page: safePage, setPage, totalPages, total, pageRows, pageSize };
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

export function TablePagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const pages = pageWindow(page, totalPages);
  return (
    <div style={barStyle}>
      <span style={metaStyle}>
        共 {total} 条 · 第 {page} / {totalPages} 页
      </span>
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
