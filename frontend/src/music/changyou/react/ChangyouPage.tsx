import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { ensureDesignTokens } from "../../../theme/designTokens";
import { CHANGYOU_ROOM_PATH, getChangyouDetailPath } from "../../router/paths";
import { fetchSongbookEntries } from "./api";
import type { SongbookEntry } from "./types";

const PAGE_SIZE = 20;
const VARIANT_OPTIONS: Array<{ key: "" | "C" | "G"; label: string }> = [
  { key: "", label: "全部" },
  { key: "C", label: "C family" },
  { key: "G", label: "G family" },
];

function buildEntrySnippet(entry: SongbookEntry) {
  const heading = entry.heading_text?.trim();
  if (heading) {
    return heading;
  }
  const firstLine = (entry.content || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "点击进入查看歌词、chord 与不同版本。";
}

function buildPagination(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
}

export function ChangyouPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { isMobile } = useUserState();
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState<"" | "C" | "G">("");
  const [entries, setEntries] = useState<SongbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [query, variant]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSongbookEntries(query, variant)
      .then((response) => {
        if (!cancelled) {
          setEntries(response.entries || []);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, variant]);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = useMemo(
    () => entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [entries, safePage],
  );
  const variantStats = useMemo(() => {
    return entries.reduce(
      (stats, entry) => {
        if (entry.variant === "C") stats.C += 1;
        if (entry.variant === "G") stats.G += 1;
        return stats;
      },
      { C: 0, G: 0 },
    );
  }, [entries]);
  const paginationItems = useMemo(() => buildPagination(safePage, totalPages), [safePage, totalPages]);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  return (
    <div style={pageStyle}>
      <div style={pageInnerStyle}>
        <section style={heroGridStyle(isMobile)}>
          <div style={heroPrimaryStyle(isMobile)}>
            <div style={eyebrowStyle}>Changyou</div>
            <h1 style={heroTitleStyle(isMobile)}>唱游歌簿</h1>
            <p style={heroCopyStyle}>
              把常用歌单、版本切换和房间播放收在一个入口里。这里可以快速查歌、切 family、再进入单曲阅读与个人编辑版。
            </p>
            <div style={statGridStyle(isMobile)}>
              <StatCard label="当前结果" value={String(entries.length)} tone="warm" />
              <StatCard label="C family" value={String(variantStats.C)} tone="cool" />
              <StatCard label="G family" value={String(variantStats.G)} tone="cool" />
              <StatCard label="当前页" value={`${safePage}/${totalPages}`} tone="plain" />
            </div>
          </div>

          <div style={heroSideStyle}>
            <div style={sideSectionStyle}>
              <div style={sideSectionLabelStyle}>快速入口</div>
              <button type="button" onClick={() => navigate(CHANGYOU_ROOM_PATH)} style={primaryActionStyle}>
                进入唱游房间
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setVariant("");
                }}
                style={secondaryActionStyle}
                disabled={!query && !variant}
              >
                清空筛选
              </button>
            </div>

            <div style={sideSectionStyle}>
              <div style={sideSectionLabelStyle}>当前筛选</div>
              <div style={filterSummaryStyle}>
                {query.trim() ? `关键词：${query.trim()}` : "关键词：全部"}
              </div>
              <div style={filterSummaryStyle}>
                {variant ? `版本：${variant} family` : "版本：全部 family"}
              </div>
            </div>
          </div>
        </section>

        <section style={controlPanelStyle}>
          <div style={controlHeaderStyle(isMobile)}>
            <div>
              <div style={panelTitleStyle}>查歌</div>
              <div style={panelCopyStyle}>搜索歌名、歌词片段或 chord，再按 family 缩小范围。</div>
            </div>
            <div style={summaryBadgeStyle}>{entries.length} 首歌曲</div>
          </div>

          <div style={searchRowStyle(isMobile)}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索歌名 / 歌词 / chord"
              style={searchInputStyle}
            />
            <button
              type="button"
              onClick={() => setQuery("")}
              style={ghostButtonStyle(isMobile)}
              disabled={!query}
            >
              清空关键词
            </button>
          </div>

          <div style={variantRowStyle}>
            {VARIANT_OPTIONS.map((option) => (
              <button
                key={option.key || "all"}
                type="button"
                onClick={() => setVariant(option.key)}
                style={variantChipStyle(variant === option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={resultsPanelStyle}>
          <div style={resultsHeaderStyle(isMobile)}>
            <div>
              <div style={panelTitleStyle}>歌曲列表</div>
              <div style={panelCopyStyle}>点进单曲页后可以切版本、调 chord family，也能保存自己的编辑版。</div>
            </div>
            <div style={summaryBadgeStyle}>第 {safePage} / {totalPages} 页</div>
          </div>

          {!loading && entries.length > 0 ? (
            <div style={paginationStyle}>
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage <= 1}
                style={pageButtonStyle(safePage <= 1)}
              >
                上一页
              </button>
              {paginationItems.map((pageNumber, index) => {
                const previous = paginationItems[index - 1];
                const needsGap = previous != null && pageNumber - previous > 1;
                return (
                  <div key={pageNumber} style={paginationSlotStyle}>
                    {needsGap ? <span style={gapTextStyle}>…</span> : null}
                    <button
                      type="button"
                      onClick={() => setPage(pageNumber)}
                      style={numberButtonStyle(pageNumber === safePage)}
                    >
                      {pageNumber}
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage >= totalPages}
                style={pageButtonStyle(safePage >= totalPages)}
              >
                下一页
              </button>
            </div>
          ) : null}

          <div style={listStyle(isMobile)}>
            {loading ? <div style={fullWidthStateStyle}>加载歌曲中…</div> : null}
            {!loading && entries.length === 0 ? <div style={fullWidthStateStyle}>没有找到歌曲。</div> : null}
            {!loading &&
              pagedEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => navigate(getChangyouDetailPath(entry.id))}
                  style={listItemStyle(isMobile)}
                >
                  <div style={cardHeaderStyle}>
                    <div style={songBadgeStyle(entry.variant)}>{entry.variant} family</div>
                    <div style={arrowStyle}>进入</div>
                  </div>
                  <div style={cardTitleStyle}>
                    {entry.song_number ? `${entry.song_number}. ` : ""}
                    {entry.title}
                  </div>
                  <div style={cardSnippetStyle}>{buildEntrySnippet(entry)}</div>
                  <div style={listItemMetaWrapStyle}>
                    <div style={listMetaPillStyle}>Key {entry.selected_key || "-"}</div>
                    <div style={listMetaPillStyle}>BPM {entry.bpm || "-"}</div>
                    <div style={listMetaPillStyle}>{entry.active_version_label || "原版"}</div>
                  </div>
                </button>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "warm" | "cool" | "plain";
}) {
  return (
    <div style={statCardStyle(tone)}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  );
}

const pageStyle = {
  minHeight: "calc(100vh - 60px)",
  padding: "24px",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 28%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
} as const;

const pageInnerStyle = {
  width: "100%",
  maxWidth: "1380px",
  margin: "0 auto",
  display: "grid",
  gap: "18px",
} as const;

const eyebrowStyle = {
  fontSize: "12px",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  opacity: 0.82,
} as const;

function heroGridStyle(isMobile: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.35fr) minmax(280px, 0.65fr)",
    gap: "16px",
  } as const;
}

function heroPrimaryStyle(isMobile: boolean) {
  return {
    padding: isMobile ? "20px 18px" : "28px",
    borderRadius: isMobile ? "22px" : "28px",
    background:
      "linear-gradient(145deg, rgba(8,28,36,0.98), rgba(15,118,110,0.92) 58%, rgba(217,119,6,0.88) 118%)",
    color: "white",
    boxShadow: "0 28px 56px rgba(15, 23, 42, 0.18)",
    display: "grid",
    gap: "16px",
  } as const;
}

function heroTitleStyle(isMobile: boolean) {
  return {
    margin: "6px 0 0",
    fontSize: isMobile ? "28px" : "40px",
    lineHeight: 1.04,
    fontWeight: 900,
  } as const;
}

const heroCopyStyle = {
  margin: 0,
  maxWidth: "62ch",
  lineHeight: 1.7,
  color: "rgba(255,255,255,0.84)",
} as const;

function statGridStyle(isMobile: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
    gap: "10px",
  } as const;
}

function statCardStyle(tone: "warm" | "cool" | "plain") {
  const palette =
    tone === "warm"
      ? "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(249,115,22,0.2))"
      : tone === "cool"
        ? "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(14,165,233,0.18))"
        : "rgba(255,255,255,0.1)";
  return {
    padding: "14px",
    borderRadius: "18px",
    background: palette,
    border: "1px solid rgba(255,255,255,0.12)",
    display: "grid",
    gap: "6px",
  } as const;
}

const statLabelStyle = {
  fontSize: "12px",
  color: "rgba(255,255,255,0.72)",
} as const;

const statValueStyle = {
  fontSize: "24px",
  fontWeight: 900,
} as const;

const heroSideStyle = {
  display: "grid",
  gap: "16px",
} as const;

const sideSectionStyle = {
  padding: "20px",
  borderRadius: "22px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "12px",
} as const;

const sideSectionLabelStyle = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
} as const;

const primaryActionStyle = {
  padding: "14px 18px",
  borderRadius: "16px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
} as const;

const secondaryActionStyle = {
  padding: "12px 16px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-strong)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
} as const;

const filterSummaryStyle = {
  padding: "10px 12px",
  borderRadius: "14px",
  background: "var(--x-color-panel-glass)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
} as const;

const controlPanelStyle = {
  padding: "18px",
  borderRadius: "24px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "16px",
} as const;

function controlHeaderStyle(isMobile: boolean) {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: "12px",
    flexDirection: isMobile ? "column" : "row",
  } as const;
}

const panelTitleStyle = {
  fontSize: "20px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
} as const;

const panelCopyStyle = {
  marginTop: "4px",
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
} as const;

const summaryBadgeStyle = {
  padding: "10px 12px",
  borderRadius: "999px",
  background: "var(--x-color-accent-tint-strong)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 800,
  fontSize: "13px",
} as const;

function searchRowStyle(isMobile: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "12px",
  } as const;
}

const searchInputStyle = {
  width: "100%",
  minHeight: "48px",
  padding: "13px 16px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box" as const,
} as const;

function ghostButtonStyle(isMobile: boolean) {
  return {
    padding: "13px 16px",
    borderRadius: "16px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-strong)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    cursor: "pointer",
    width: isMobile ? "100%" : undefined,
  } as const;
}

const variantRowStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap" as const,
} as const;

function variantChipStyle(active: boolean) {
  return {
    padding: "10px 14px",
    borderRadius: "999px",
    border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
    background: active ? "var(--x-color-accent)" : "var(--x-color-panel)",
    color: active ? "white" : "var(--x-color-ink)",
    fontWeight: 800,
    cursor: "pointer",
  };
}

const resultsPanelStyle = {
  padding: "18px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "16px",
} as const;

function resultsHeaderStyle(isMobile: boolean) {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: "12px",
    flexDirection: isMobile ? "column" : "row",
  } as const;
}

const paginationStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap" as const,
  alignItems: "center",
} as const;

const paginationSlotStyle = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
} as const;

const gapTextStyle = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
} as const;

const pageButtonStyle = (disabled: boolean) => ({
  padding: "10px 14px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-line)",
  background: disabled ? "var(--x-color-panel-alt)" : "var(--x-color-panel)",
  color: disabled ? "var(--x-color-ink-muted)" : "var(--x-color-ink)",
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 700,
});

const numberButtonStyle = (active: boolean) => ({
  minWidth: "42px",
  padding: "10px 12px",
  borderRadius: "12px",
  border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: active ? "var(--x-color-accent)" : "var(--x-color-panel)",
  color: active ? "white" : "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 800,
});

function listStyle(isMobile: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
  } as const;
}

function listItemStyle(isMobile: boolean) {
  return {
    padding: isMobile ? "16px" : "18px",
    borderRadius: "20px",
    border: "1px solid var(--x-color-line-soft)",
    background: "linear-gradient(180deg, var(--x-color-panel-strong), var(--x-color-panel))",
    textAlign: "left" as const,
    cursor: "pointer",
    boxShadow: "0 10px 24px var(--x-color-shadow-soft)",
    display: "grid",
    gap: "12px",
    minHeight: isMobile ? undefined : "210px",
    alignContent: "start",
  } as const;
}

const cardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
} as const;

const songBadgeStyle = (variant: string) => ({
  width: "fit-content",
  padding: "6px 10px",
  borderRadius: "999px",
  background: variant === "C" ? "rgba(14,165,233,0.1)" : "rgba(15,118,110,0.12)",
  color: variant === "C" ? "#0369a1" : "var(--x-color-accent-strong)",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.04em",
});

const arrowStyle = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
} as const;

const cardTitleStyle = {
  fontWeight: 900,
  color: "var(--x-color-ink)",
  fontSize: "18px",
  lineHeight: 1.35,
} as const;

const cardSnippetStyle = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
  wordBreak: "break-word" as const,
} as const;

const listItemMetaWrapStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "8px",
} as const;

const listMetaPillStyle = {
  padding: "7px 10px",
  borderRadius: "999px",
  background: "var(--x-color-panel-glass)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
} as const;

const stateStyle = {
  minHeight: "120px",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
} as const;

const fullWidthStateStyle = {
  ...stateStyle,
  width: "100%",
} as const;

const errorStyle = {
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(220,38,38,0.08)",
  color: "var(--x-color-danger)",
  border: "1px solid rgba(220,38,38,0.16)",
} as const;
