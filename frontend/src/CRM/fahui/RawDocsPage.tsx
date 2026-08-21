import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { useOptionalAppChrome } from "../../router/AppChromeContext";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { API_BASE } from "../../js/apiBase";
import { show_alert } from "../../js/show_alert";
import {
  copyYlpOrdersToCurrent,
  createYlpOrder,
  fetchFahuiRawDocs,
  setFahuiRawDocFlag,
  suggestOldOrdersForRawDoc,
  updateFahuiRawDocLink,
  uploadFahuiRawDocs,
  type FahuiOldOrderSuggestion,
} from "./api";
import { YlpOrderSummaryDrawer } from "./YlpOrderSummaryDrawer";
import type { FahuiRawDoc } from "./types";

// 法会「原始文档」：左边是手写单据原图清单，点一张右边就看大图。
// 图片走带权限的 /api/fahui_router/raw_docs/file/...（单据上有姓名电话，不能走公开 /media_file）。
function fileUrl(filename: string) {
  const path = `/api/fahui_router/raw_docs/file/${encodeURIComponent(filename)}`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

function formatSize(bytes: number) {
  if (!bytes) return "-";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

const PAGE_CSS = `
.raw-docs-page button:focus { outline: none; }
.raw-docs-page button:focus-visible { outline: 2px solid var(--x-color-accent); outline-offset: -2px; }
.raw-docs-page .raw-docs-list-item { -webkit-tap-highlight-color: transparent; }
`;

function confidenceLabel(confidence?: string | null) {
  if (confidence === "high") return "高信心";
  if (confidence === "medium") return "待确认";
  if (confidence === "low") return "低信心";
  if (confidence === "manual") return "手动";
  return "";
}

/** 从 WhatsApp 文件名里取出时间那截，列表上比整串名字好读。 */
function shortLabel(doc: FahuiRawDoc) {
  const match = doc.filename.match(/at\s+(.+)\.(jpe?g|png|webp|gif|heic)$/i);
  return match ? match[1] : doc.filename;
}

const PAGE_SIZE = 12;

export function FahuiRawDocsPage() {
  useEnsureDesignTokens();
  const { isMobile } = useUserState();
  const navbarHeight = useOptionalAppChrome()?.navbarHeight ?? 60;
  const navigate = useNavigate();

  const [docs, setDocs] = useState<FahuiRawDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [page, setPage] = useState(1);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  // 「找旧单」：BytePlus 读图 + 往年版本里找最像的订单
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [suggest, setSuggest] = useState<{
    candidates: FahuiOldOrderSuggestion[];
    ocrNote: string;
  } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  // 点订单号后从右侧划入的摘要抽屉
  const [summaryOrderId, setSummaryOrderId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchFahuiRawDocs();
        if (cancelled) return;
        const items = res.data?.items || [];
        setDocs(items);
        setSelected((current) => current || items[0]?.filename || null);
        setError(res.data?.ready === false ? "存档目录还不存在（database/fahui_raw_img）" : "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "读取失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dates = useMemo(
    () => Array.from(new Set(docs.map((doc) => doc.date).filter(Boolean))).sort().reverse() as string[],
    [docs],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return docs.filter((doc) => {
      if (dateFilter && doc.date !== dateFilter) return false;
      if (!keyword) return true;
      const orderIds = (doc.orders || []).map((link) => `#${link.order_id}`).join(" ");
      return [doc.filename, doc.customer, doc.phone, doc.extract, doc.declared_total, doc.plan, orderIds]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(keyword));
    });
  }, [docs, query, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    setPage(1);
  }, [query, dateFilter]);

  const activeDoc = useMemo(
    () => filtered.find((doc) => doc.filename === selected) || docs.find((doc) => doc.filename === selected) || null,
    [filtered, docs, selected],
  );
  const activeIndex = filtered.findIndex((doc) => doc.filename === selected);

  // 用 ref 拿最新的 docs：切图时要读它挑第一张订单，但不能因为 docs 变化（勾选待核等）就重新触发
  const docsRef = useRef(docs);
  docsRef.current = docs;

  // 换一张单据：清掉审核区提示，并默认弹出它第一张绑定订单的摘要（没绑定就收起抽屉）
  useEffect(() => {
    setLinkMsg("");
    setLinkInput("");
    setSuggest(null);
    const doc = docsRef.current.find((item) => item.filename === selected);
    setSummaryOrderId(doc?.orders?.length ? doc.orders[0].order_id : null);
  }, [selected]);

  // Esc 关抽屉
  useEffect(() => {
    if (summaryOrderId == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSummaryOrderId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [summaryOrderId]);

  // 审核：确认 / 解除 / 手动挂上一张订单，结果直接替换该单据的资料
  async function applyLink(orderId: number, action: "add" | "confirm" | "remove") {
    const doc = activeDoc;
    if (!doc?.id || linkBusy || !orderId) return;
    setLinkBusy(true);
    setLinkMsg("");
    try {
      const res = await updateFahuiRawDocLink(doc.id, orderId, action);
      const next = res.data;
      if (next) {
        setDocs((current) => current.map((item) => (item.filename === next.filename ? next : item)));
      }
      setLinkMsg(action === "remove" ? `已解除 #${orderId}` : `已确认 #${orderId}`);
      if (action === "add") setLinkInput("");
    } catch (err) {
      setLinkMsg(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleUpload(files: File[]) {
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      const res = await uploadFahuiRawDocs(files);
      const saved = res.data?.saved || [];
      const skipped = res.data?.skipped || [];
      await reloadDocs();
      if (saved.length) {
        setQuery("");
        setDateFilter("");
        setPage(1);
        setSelected(saved[0]);
        show_alert("success", `已上传 ${saved.length} 张${skipped.length ? `，跳过 ${skipped.length} 张` : ""}`);
      }
      if (skipped.length) {
        show_alert("error", skipped.map((item) => `${item.filename}：${item.reason}`).join("；").slice(0, 200));
      }
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function reloadDocs() {
    try {
      const res = await fetchFahuiRawDocs();
      setDocs(res.data?.items || []);
    } catch {
      /* 刷新失败不打断当前操作 */
    }
  }

  async function toggleFlag(flagId: number, resolved: boolean) {
    const doc = activeDoc;
    if (!doc?.id || linkBusy) return;
    setLinkBusy(true);
    try {
      const res = await setFahuiRawDocFlag(doc.id, flagId, resolved);
      const next = res.data;
      if (next) {
        setDocs((current) => current.map((item) => (item.filename === next.filename ? next : item)));
      }
    } catch (err) {
      setLinkMsg(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLinkBusy(false);
    }
  }

  async function runSuggest() {
    const doc = activeDoc;
    if (!doc?.id || suggestBusy) return;
    setSuggestBusy(true);
    setSuggest(null);
    try {
      const res = await suggestOldOrdersForRawDoc(doc.id);
      const data = res.data;
      const ocr = data?.ocr;
      const read = [
        ocr?.customer ? `施主 ${ocr.customer}` : "",
        ocr?.phones?.length ? `电话 ${ocr.phones.join("/")}` : "",
        ocr?.totals?.length ? `合共 RM${ocr.totals[0]}` : "",
        ocr?.red_pen_number ? `红笔 ${ocr.red_pen_number}` : "",
        ocr?.item_count ? `${ocr.item_count} 笔` : "",
      ].filter(Boolean);
      setSuggest({
        candidates: data?.candidates || [],
        ocrNote: ocr?.ok
          ? `BytePlus 读到：${read.length ? read.join(" · ") : "手写栏没读到内容"}`
          : `BytePlus 读图失败：${ocr?.error || "未知原因"}`,
      });
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "找旧单失败");
    } finally {
      setSuggestBusy(false);
    }
  }

  /** 复制往年那张到今年，并把新订单挂到这张单据上。 */
  async function useOldOrder(oldOrderId: number) {
    const doc = activeDoc;
    if (!doc?.id || suggestBusy) return;
    setSuggestBusy(true);
    try {
      const res = await copyYlpOrdersToCurrent([oldOrderId]);
      const newId = res.copied?.[0]?.new_id;
      if (!newId) {
        throw new Error(res.skipped?.[0]?.reason || res.message || "复制失败");
      }
      const linked = await updateFahuiRawDocLink(doc.id, newId, "add");
      if (linked.data) {
        setDocs((current) => current.map((item) => (item.filename === linked.data!.filename ? linked.data! : item)));
      }
      setSuggest(null);
      setSummaryOrderId(newId);
      show_alert("success", `已复制 #${oldOrderId} → 新订单 #${newId}，并挂到这张单据`);
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "复制失败");
    } finally {
      setSuggestBusy(false);
    }
  }

  /** 都不像：用单据上的施主/电话开一张今年的空订单，再进抽屉补牌位。 */
  async function createFreshOrder() {
    const doc = activeDoc;
    if (!doc?.id || suggestBusy) return;
    const name = (doc.customer || "").trim();
    const phone = (doc.phone || "").trim();
    if (!name || !phone) {
      show_alert("error", "这张单据还没有施主或电话，请先在抽取资料里补上");
      return;
    }
    setSuggestBusy(true);
    try {
      const res = await createYlpOrder({ name, customer_name: name, phone });
      const newId = res.order?.id;
      if (!newId) {
        throw new Error(res.message || "建单失败");
      }
      if (res.duplicated) {
        show_alert("success", `今年已有同名同号的订单 #${newId}，直接挂上`);
      }
      const linked = await updateFahuiRawDocLink(doc.id, newId, "add");
      if (linked.data) {
        setDocs((current) => current.map((item) => (item.filename === linked.data!.filename ? linked.data! : item)));
      }
      setSuggest(null);
      setSummaryOrderId(newId);
      show_alert("success", `已新建订单 #${newId}，在右侧抽屉里加牌位`);
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "建单失败");
    } finally {
      setSuggestBusy(false);
    }
  }

  function step(delta: number) {
    if (!filtered.length) return;
    const next = activeIndex < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, activeIndex + delta));
    setSelected(filtered[next].filename);
    // 翻到别页的单据时列表跟着跳页
    setPage(Math.floor(next / PAGE_SIZE) + 1);
  }

  return (
    <section className="raw-docs-page" style={styles.page(isMobile, navbarHeight)}>
      <style>{PAGE_CSS}</style>
      {error ? <div style={styles.errorBox}>{error}</div> : null}

      <div className="raw-docs-body" style={styles.body(isMobile, summaryOrderId != null, sideCollapsed)}>
        <aside className="raw-docs-side" style={styles.side}>
          {/* 搜索与筛选放左栏顶部，右侧整块留给图片 */}
          <div className="raw-docs-side-toolbar" style={styles.toolbar}>
            <div style={styles.toolbarRow}>
              {sideCollapsed ? null : (
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索施主 / 电话 / 文件名"
                  style={styles.search}
                />
              )}
              <button
                type="button"
                style={styles.uploadButton}
                title="上传原始单据图（可多选）"
                aria-label="上传单据图"
                disabled={uploading}
                onClick={() => uploadInputRef.current?.click()}
              >
                <i className={uploading ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-upload"} aria-hidden="true" />
                {sideCollapsed ? null : <span style={{ marginLeft: 5 }}>{uploading ? "上传中" : "上传"}</span>}
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const picked = Array.from(event.target.files || []);
                  event.target.value = "";
                  void handleUpload(picked);
                }}
              />
              <button
                type="button"
                style={styles.collapseButton}
                title={sideCollapsed ? "展开清单" : "收起清单（只留名字）"}
                aria-label={sideCollapsed ? "展开清单" : "收起清单"}
                onClick={() => setSideCollapsed((current) => !current)}
              >
                {sideCollapsed ? "»" : "«"}
              </button>
            </div>
            {sideCollapsed ? null : (
              <div style={styles.toolbarRow}>
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} style={styles.select}>
                  <option value="">全部日期</option>
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
                {query || dateFilter ? (
                  <button
                    type="button"
                    style={styles.ghostButton}
                    onClick={() => {
                      setQuery("");
                      setDateFilter("");
                    }}
                  >
                    清除
                  </button>
                ) : (
                  <span style={styles.countHint}>{loading ? "读取中…" : `共 ${docs.length} 张`}</span>
                )}
              </div>
            )}
          </div>

          <div className="raw-docs-list" style={styles.list}>
            {loading ? <div style={styles.stateCard}>加载中…</div> : null}
            {!loading && !filtered.length ? <div style={styles.stateCard}>没有符合条件的单据</div> : null}
            {pageItems.map((doc) => {
              const active = doc.filename === selected;
              return (
                <button
                  key={doc.filename}
                  type="button"
                  className="raw-docs-list-item"
                  style={{
                    ...styles.listItem,
                    ...(sideCollapsed ? styles.listItemSlim : null),
                    ...(active ? styles.listItemActive : null),
                  }}
                  title={sideCollapsed ? `${doc.customer || shortLabel(doc)}　${doc.date || ""}` : undefined}
                  onClick={() => setSelected(doc.filename)}
                >
                  {sideCollapsed ? null : (
                    <img src={fileUrl(doc.filename)} alt="" loading="lazy" style={styles.thumb} />
                  )}
                  <span style={styles.itemBody}>
                    <span style={styles.itemTitle}>{doc.customer || shortLabel(doc)}</span>
                    {sideCollapsed ? null : (
                      <span style={styles.itemMeta}>
                        {doc.date || "无日期"} · {formatSize(doc.size)}
                        {doc.declared_total ? ` · RM ${doc.declared_total}` : ""}
                      </span>
                    )}
                    <span style={styles.itemChips}>
                      {(doc.orders || []).length ? (
                        (doc.orders || []).map((link) => (
                          <span key={link.order_id} style={styles.chipOrder}>#{link.order_id}</span>
                        ))
                      ) : sideCollapsed ? null : (
                        <span style={styles.chipWarn}>未对上订单</span>
                      )}
                      {!sideCollapsed && doc.flags_open ? <span style={styles.chipFlag}>待核 {doc.flags_open}</span> : null}
                      {!sideCollapsed && doc.duplicate_of ? <span style={styles.chipMuted}>重复</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="raw-docs-pager" style={styles.pager}>
            <button type="button" style={styles.pagerButton} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              {sideCollapsed ? "‹" : "上一页"}
            </button>
            <span style={styles.pagerText}>
              {safePage}/{totalPages}
              {sideCollapsed ? "" : `　共 ${filtered.length} 张`}
            </span>
            <button
              type="button"
              style={styles.pagerButton}
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              {sideCollapsed ? "›" : "下一页"}
            </button>
          </div>
        </aside>

        <main className="raw-docs-viewer" style={styles.viewer}>
          {activeDoc ? (
            <>
              <header style={styles.viewerHead}>
                <div style={{ minWidth: 0 }}>
                  <p style={styles.viewerTitle}>
                    {activeDoc.customer || "未录入施主"}
                    {activeDoc.phone ? <span style={styles.viewerSub}>{activeDoc.phone}</span> : null}
                    {activeDoc.declared_total ? <span style={styles.viewerSub}>RM {activeDoc.declared_total}</span> : null}
                    {activeDoc.extract ? <span style={styles.viewerSub}>{activeDoc.extract}</span> : null}
                  </p>
                  <p style={styles.viewerMeta}>{activeDoc.filename}</p>
                </div>
                <div style={styles.viewerActions}>
                  <button type="button" style={styles.ghostButton} disabled={activeIndex <= 0} onClick={() => step(-1)}>
                    上一张
                  </button>
                  <span style={styles.counter}>
                    {activeIndex >= 0 ? activeIndex + 1 : "-"} / {filtered.length}
                  </span>
                  <button
                    type="button"
                    style={styles.ghostButton}
                    disabled={activeIndex < 0 || activeIndex >= filtered.length - 1}
                    onClick={() => step(1)}
                  >
                    下一张
                  </button>
                  <button type="button" style={styles.ghostButton} onClick={() => setZoomed((current) => !current)}>
                    {zoomed ? "还原" : "放大"}
                  </button>
                  <button
                    type="button"
                    style={styles.suggestButton}
                    disabled={suggestBusy}
                    title="用 BytePlus 读这张图，再到往年版本里找最像的订单"
                    onClick={() => void runSuggest()}
                  >
                    <i
                      className={suggestBusy ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-wand-magic-sparkles"}
                      aria-hidden="true"
                    />
                    {suggestBusy ? "查找中…" : "找旧单"}
                  </button>
                  <a href={fileUrl(activeDoc.filename)} target="_blank" rel="noreferrer" style={styles.linkButton}>
                    新窗口
                  </a>
                </div>
              </header>

              {/* 已对上的订单：点一下直接进订单详情 */}
              <div className="raw-docs-order-bar" style={styles.orderBar}>
                {(activeDoc.orders || []).length ? (
                  <>
                    <span style={styles.orderBarLabel}>已对上订单</span>
                    {(activeDoc.orders || []).map((link) => (
                      <button
                        key={link.order_id}
                        type="button"
                        style={{
                          ...styles.orderChip,
                          ...(link.confidence === "high" ? styles.orderChipHigh : null),
                        }}
                        title={`${link.customer_name || ""} · ${confidenceLabel(link.confidence)}（${link.match_by || "-"}）`}
                        onClick={() => setSummaryOrderId(link.order_id)}
                      >
                        #{link.order_id}
                        {link.confidence && link.confidence !== "high" ? (
                          <span style={styles.orderChipHint}>{confidenceLabel(link.confidence)}</span>
                        ) : null}
                      </button>
                    ))}
                  </>
                ) : (
                  <span style={styles.orderBarEmpty}>还没对上 2026_YLP 的订单</span>
                )}
              </div>

              {suggest ? (
                <div className="raw-docs-suggest" style={styles.suggestBox}>
                  <div style={styles.suggestHead}>
                    <span style={styles.suggestTitle}>
                      往年最相似的 {suggest.candidates.length} 张单
                    </span>
                    <span style={styles.suggestNote}>{suggest.ocrNote}</span>
                    <button type="button" style={styles.suggestClose} onClick={() => setSuggest(null)}>
                      收起
                    </button>
                  </div>

                  <div style={styles.suggestList}>
                    {suggest.candidates.map((candidate) => (
                      <div key={candidate.id} style={styles.suggestItem}>
                        <span style={styles.suggestOrder}>#{candidate.id}</span>
                        <span style={styles.suggestMain}>
                          <span style={styles.suggestName}>
                            {candidate.customer_name || "未填功德主"}
                            <span style={styles.suggestVersion}>{candidate.version}</span>
                          </span>
                          <span style={styles.suggestMeta}>
                            {candidate.phone || "无电话"} · RM {Number(candidate.total ?? 0).toFixed(2)} ·{" "}
                            {candidate.item_count ?? 0} 笔
                          </span>
                          <span style={styles.suggestReasons}>
                            {(candidate.reasons || []).map((reason) => (
                              <span key={reason} style={styles.suggestReason}>
                                {reason}
                              </span>
                            ))}
                          </span>
                        </span>
                        <button
                          type="button"
                          style={styles.suggestPick}
                          disabled={suggestBusy}
                          onClick={() => void useOldOrder(candidate.id)}
                        >
                          就是这张 · 复制到今年
                        </button>
                      </div>
                    ))}
                    {!suggest.candidates.length ? (
                      <span style={styles.suggestEmpty}>往年版本里没找到相似的单据</span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    style={styles.suggestNew}
                    disabled={suggestBusy}
                    onClick={() => void createFreshOrder()}
                  >
                    全部都不是，新建一个订单
                  </button>
                </div>
              ) : null}

              {/* 剩下的高度全给图片；contain 缩放，不裁切 */}
              <div className="raw-docs-image" style={styles.imageWrap}>
                <img
                  src={fileUrl(activeDoc.filename)}
                  alt={activeDoc.filename}
                  style={zoomed ? styles.imageZoomed : styles.image}
                  onClick={() => setZoomed((current) => !current)}
                />
              </div>
            </>
          ) : (
            <div style={styles.stateCard}>{loading ? "加载中…" : "左边选一张单据"}</div>
          )}
        </main>

        <aside className="raw-docs-review" style={styles.review}>
          <p style={styles.reviewTitle}>匹配审核</p>
          {activeDoc ? (
            <>
              <div style={styles.reviewDoc}>
                <span style={styles.reviewDocLine}>单据申报</span>
                <span style={styles.reviewDocValue}>
                  {activeDoc.customer || "无施主"}　RM {activeDoc.declared_total || "-"}
                </span>
                <span style={styles.reviewDocLine}>
                  电话 {activeDoc.phone || "-"}　{activeDoc.extract || "无抽取档"}
                  {(activeDoc.flags || []).length ? `　待核 ${activeDoc.flags_open ?? 0}/${(activeDoc.flags || []).length}` : ""}
                </span>
              </div>

              <div style={styles.reviewList}>
                {(activeDoc.orders || []).length ? (
                  (activeDoc.orders || []).map((link) => {
                    const declared = Number(activeDoc.declared_total || 0);
                    const gap = link.order_total != null && declared ? Number(link.order_total) - declared : 0;
                    const nameSame =
                      !!activeDoc.customer && !!link.customer_name && link.customer_name.includes(activeDoc.customer);
                    return (
                      <div key={link.order_id} style={styles.reviewCard}>
                        <div style={styles.reviewCardHead}>
                          <button
                            type="button"
                            style={styles.reviewOrderLink}
                            onClick={() => setSummaryOrderId(link.order_id)}
                          >
                            #{link.order_id}
                          </button>
                          <span
                            style={{
                              ...styles.reviewBadge,
                              ...(link.confidence === "manual"
                                ? styles.reviewBadgeOk
                                : link.confidence === "high"
                                  ? styles.reviewBadgeHigh
                                  : styles.reviewBadgeWarn),
                            }}
                          >
                            {confidenceLabel(link.confidence)}
                          </span>
                        </div>
                        <div style={styles.reviewRow}>
                          <span style={styles.reviewKey}>订单</span>
                          <span style={nameSame ? styles.reviewOk : styles.reviewDiff}>
                            {link.customer_name || "-"}
                          </span>
                        </div>
                        <div style={styles.reviewRow}>
                          <span style={styles.reviewKey}>金额</span>
                          <span style={gap === 0 ? styles.reviewOk : styles.reviewDiff}>
                            RM {Number(link.order_total ?? 0).toFixed(2)}
                            {gap !== 0 ? `（差 ${gap > 0 ? "+" : ""}${gap.toFixed(2)}）` : ""}
                            　{link.item_count ?? 0} 笔
                          </span>
                        </div>
                        <div style={styles.reviewRow}>
                          <span style={styles.reviewKey}>依据</span>
                          <span style={styles.reviewMeta}>{link.match_by || "-"}</span>
                        </div>
                        <div style={styles.reviewActions}>
                          {link.confidence !== "manual" ? (
                            <button
                              type="button"
                              style={styles.reviewConfirm}
                              disabled={linkBusy}
                              onClick={() => void applyLink(link.order_id, "confirm")}
                            >
                              确认无误
                            </button>
                          ) : (
                            <span style={styles.reviewConfirmed}>✓ 已人工确认</span>
                          )}
                          <button
                            type="button"
                            style={styles.reviewRemove}
                            disabled={linkBusy}
                            onClick={() => void applyLink(link.order_id, "remove")}
                          >
                            解除
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={styles.reviewEmpty}>这张单据还没对上订单，可在下面手动挂。</div>
                )}
              </div>

              {(activeDoc.flags || []).length ? (
                <div className="raw-docs-flags" style={styles.flagBox}>
                  <p style={styles.flagHead}>
                    待核备注
                    <span style={styles.flagCount}>
                      未处理 {activeDoc.flags_open ?? 0} / {(activeDoc.flags || []).length}
                    </span>
                  </p>
                  {(activeDoc.flags || []).map((flag) => (
                    <label
                      key={flag.id}
                      style={{ ...styles.flagItem, ...(flag.resolved ? styles.flagItemDone : null) }}
                      title={flag.resolved_by ? `已由 ${flag.resolved_by} 标记处理` : "勾选表示已处理"}
                    >
                      <input
                        type="checkbox"
                        checked={flag.resolved}
                        disabled={linkBusy}
                        onChange={(event) => void toggleFlag(flag.id, event.target.checked)}
                        style={styles.flagCheck}
                      />
                      <span style={flag.resolved ? styles.flagTextDone : styles.flagText}>{flag.text}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              <div style={styles.reviewAdd}>
                <input
                  value={linkInput}
                  onChange={(event) => setLinkInput(event.target.value.replace(/\D/g, ""))}
                  placeholder="订单号，例如 737"
                  style={styles.reviewInput}
                />
                <button
                  type="button"
                  style={styles.reviewAddButton}
                  disabled={linkBusy || !linkInput}
                  onClick={() => void applyLink(Number(linkInput), "add")}
                >
                  挂上
                </button>
              </div>
              {linkMsg ? <span style={styles.reviewMsg}>{linkMsg}</span> : null}
              <span style={styles.reviewHint}>
                「确认无误」会把这条标成人工确认，重新扫描时不会被自动匹配覆盖。
              </span>
            </>
          ) : (
            <div style={styles.reviewEmpty}>左边选一张单据</div>
          )}
        </aside>

        {/* 摘要抽屉就排在 main 容器里当一栏，从右侧滑入；内容与编辑能力由共享组件提供 */}
        {summaryOrderId != null ? (
          <YlpOrderSummaryDrawer
            orderId={summaryOrderId}
            isMobile={isMobile}
            navbarHeight={navbarHeight}
            onClose={() => setSummaryOrderId(null)}
            onOpenDetail={(id) =>
              navigate(`/crm/dharma_event?fahui_view=ylp_order&fahui_workspace=ylp&fahui_order_id=${id}`)
            }
            onChanged={() => void reloadDocs()}
          />
        ) : null}
      </div>
    </section>
  );
}
const styles = {
  page: (isMobile: boolean, navbarHeight: number): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: isMobile ? "10px" : "12px 16px",
    height: isMobile ? "auto" : `calc(100vh - ${navbarHeight + 12}px)`,
    minHeight: 0,
    boxSizing: "border-box",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
  }),
  body: (isMobile: boolean, drawerOpen: boolean, sideCollapsed: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: isMobile
      ? "1fr"
      : `${sideCollapsed ? "132px" : "minmax(200px, 260px)"} minmax(0, 1fr) minmax(230px, 280px)${
          drawerOpen ? " auto" : ""
        }`,
    gap: "12px",
    flex: 1,
    minHeight: 0,
    alignItems: "stretch",
  }),
  side: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minHeight: 0,
  },
  toolbar: { display: "flex", flexDirection: "column", gap: "6px" },
  toolbarRow: { display: "flex", gap: "6px", alignItems: "center" },
  search: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
  },
  select: {
    flex: 1,
    minWidth: 0,
    padding: "7px 9px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12.5px",
  },
  uploadButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 30,
    padding: "0 10px",
    flexShrink: 0,
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  collapseButton: {
    width: 28,
    height: 30,
    flexShrink: 0,
    padding: 0,
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  countHint: { fontSize: "11.5px", color: "var(--x-color-ink-muted)", whiteSpace: "nowrap" },
  ghostButton: {
    padding: "6px 11px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  linkButton: {
    padding: "6px 11px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12.5px",
    fontWeight: 700,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  errorBox: {
    padding: "9px 12px",
    borderRadius: "8px",
    background: "var(--x-color-danger-soft)",
    border: "1px solid var(--x-color-danger-border)",
    color: "var(--x-color-danger)",
    fontSize: "13px",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "6px",
    borderRadius: "12px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
  },
  listItem: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    padding: "6px",
    borderRadius: "9px",
    border: "1px solid transparent",
    background: "var(--x-color-panel)",
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
  },
  listItemSlim: { padding: "5px 6px" },
  // 必须用 border 简写：只写 borderColor 的话，取消选中时 React 清掉长写属性，
  // border-color 会回退成 currentColor（深墨色），看起来就是一圈黑边。
  listItemActive: {
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
  },
  thumb: {
    width: 42,
    height: 42,
    flexShrink: 0,
    objectFit: "contain",
    borderRadius: "7px",
    background: "var(--x-color-panel-alt)",
  },
  itemBody: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 },
  itemTitle: {
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemMeta: { fontSize: "11.5px", color: "var(--x-color-ink-muted)" },
  itemChips: { display: "flex", gap: "4px", flexWrap: "wrap" },
  chip: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
    fontSize: "10.5px",
    color: "var(--x-color-ink-muted)",
  },
  chipWarn: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-warning-soft)",
    color: "var(--x-color-warning)",
    fontSize: "10.5px",
    fontWeight: 700,
  },
  chipFlag: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
    fontSize: "10.5px",
    fontWeight: 700,
  },
  chipOrder: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    fontSize: "10.5px",
    fontWeight: 800,
  },
  chipMuted: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    fontSize: "10.5px",
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    flexShrink: 0,
  },
  pagerButton: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
  },
  pagerText: { fontSize: "11.5px", color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)" },
  viewer: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    borderRadius: "12px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    minWidth: 0,
    minHeight: 0,
  },
  viewerHead: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
    flexShrink: 0,
  },
  viewerTitle: { margin: 0, fontSize: "15px", fontWeight: 800, display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" },
  viewerSub: { fontSize: "12px", fontWeight: 600, color: "var(--x-color-ink-muted)" },
  viewerMeta: {
    margin: "2px 0 0",
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
    overflowWrap: "anywhere",
  },
  viewerActions: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
  counter: { fontSize: "12px", color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)" },
  orderBar: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", flexShrink: 0 },
  orderBarLabel: { fontSize: "11.5px", fontWeight: 800, color: "var(--x-color-ink-muted)" },
  orderBarEmpty: { fontSize: "11.5px", color: "var(--x-color-ink-muted)" },
  orderChip: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "5px",
    padding: "4px 12px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  orderChipHigh: {
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
  },
  orderChipHint: { fontSize: "10.5px", fontWeight: 600, color: "var(--x-color-warning)" },
  suggestButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "6px 12px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "12.5px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  suggestBox: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "8px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    flexShrink: 0,
  },
  suggestHead: { display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" },
  suggestTitle: { fontSize: "12.5px", fontWeight: 800 },
  suggestNote: { flex: 1, minWidth: 0, fontSize: "11px", color: "var(--x-color-ink-muted)" },
  suggestClose: {
    padding: "3px 9px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "11.5px",
    fontWeight: 700,
    cursor: "pointer",
  },
  suggestList: { display: "flex", flexDirection: "column", gap: "5px" },
  suggestItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "8px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
  },
  suggestOrder: { fontSize: "14px", fontWeight: 800, color: "var(--x-color-accent-strong)", flexShrink: 0 },
  suggestMain: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0, flex: 1 },
  suggestName: { fontSize: "13px", fontWeight: 700, display: "flex", gap: "6px", alignItems: "baseline" },
  suggestVersion: { fontSize: "10.5px", fontWeight: 700, color: "var(--x-color-ink-muted)" },
  suggestMeta: { fontSize: "11.5px", color: "var(--x-color-ink-muted)" },
  suggestReasons: { display: "flex", gap: "4px", flexWrap: "wrap" },
  suggestReason: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
    fontSize: "10.5px",
    fontWeight: 700,
  },
  suggestPick: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "11.5px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  suggestEmpty: { fontSize: "12px", color: "var(--x-color-ink-muted)", padding: "4px 2px" },
  suggestNew: {
    padding: "7px 10px",
    borderRadius: "8px",
    border: "1px dashed var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  imageWrap: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    overflow: "auto",
  },
  // 整张放进容器、按比例缩放，不裁切
  image: {
    maxWidth: "100%",
    maxHeight: "100%",
    width: "auto",
    height: "auto",
    objectFit: "contain",
    cursor: "zoom-in",
    display: "block",
  },
  imageZoomed: {
    width: "auto",
    height: "auto",
    maxWidth: "none",
    maxHeight: "none",
    transform: "scale(1)",
    cursor: "zoom-out",
    display: "block",
  },
  review: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minHeight: 0,
    overflowY: "auto",
    padding: "10px",
    borderRadius: "12px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
  },
  reviewTitle: { margin: 0, fontSize: "13px", fontWeight: 800 },
  reviewDoc: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px",
    borderRadius: "9px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
  },
  reviewDocLine: { fontSize: "11px", color: "var(--x-color-ink-muted)" },
  reviewDocValue: { fontSize: "13px", fontWeight: 800 },
  reviewList: { display: "flex", flexDirection: "column", gap: "6px" },
  reviewCard: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "8px",
    borderRadius: "9px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
  },
  reviewCardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" },
  reviewOrderLink: {
    padding: 0,
    border: "none",
    background: "none",
    color: "var(--x-color-accent-strong)",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
    textDecoration: "underline",
  },
  reviewBadge: { padding: "1px 8px", borderRadius: "999px", fontSize: "10.5px", fontWeight: 800 },
  reviewBadgeHigh: { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" },
  reviewBadgeWarn: { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" },
  reviewBadgeOk: { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" },
  reviewRow: { display: "flex", gap: "6px", fontSize: "11.5px", alignItems: "baseline" },
  reviewKey: { width: 30, flexShrink: 0, color: "var(--x-color-ink-muted)" },
  reviewOk: { color: "var(--x-color-ink)" },
  reviewDiff: { color: "var(--x-color-warning)", fontWeight: 700 },
  reviewMeta: { color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)", fontSize: "11px" },
  reviewActions: { display: "flex", gap: "6px", marginTop: "3px", alignItems: "center" },
  reviewConfirm: {
    flex: 1,
    padding: "5px 8px",
    borderRadius: "7px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "11.5px",
    fontWeight: 800,
    cursor: "pointer",
  },
  reviewConfirmed: { flex: 1, fontSize: "11.5px", fontWeight: 700, color: "var(--x-color-success)" },
  reviewRemove: {
    padding: "5px 10px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "11.5px",
    fontWeight: 700,
    cursor: "pointer",
  },
  flagBox: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px",
    borderRadius: "9px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
  },
  flagHead: {
    margin: 0,
    display: "flex",
    justifyContent: "space-between",
    gap: "6px",
    alignItems: "baseline",
    fontSize: "12px",
    fontWeight: 800,
  },
  flagCount: { fontSize: "10.5px", fontWeight: 700, color: "var(--x-color-warning)" },
  flagItem: {
    display: "flex",
    gap: "6px",
    alignItems: "flex-start",
    padding: "4px 2px",
    borderTop: "1px dashed var(--x-color-line-soft)",
    cursor: "pointer",
  },
  flagItemDone: { opacity: 0.55 },
  flagCheck: { marginTop: 2, width: 14, height: 14, flexShrink: 0, accentColor: "var(--x-color-accent)" },
  flagText: { fontSize: "11.5px", lineHeight: 1.5, color: "var(--x-color-ink)", overflowWrap: "anywhere" },
  flagTextDone: {
    fontSize: "11.5px",
    lineHeight: 1.5,
    color: "var(--x-color-ink-muted)",
    textDecoration: "line-through",
    overflowWrap: "anywhere",
  },
  reviewEmpty: { fontSize: "12px", color: "var(--x-color-ink-muted)", padding: "6px 0" },
  reviewAdd: { display: "flex", gap: "6px" },
  reviewInput: {
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
  },
  reviewAddButton: {
    padding: "6px 12px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  reviewMsg: { fontSize: "11.5px", color: "var(--x-color-success)" },
  reviewHint: { fontSize: "10.5px", color: "var(--x-color-ink-muted)", lineHeight: 1.5 },
  stateCard: {
    padding: "18px",
    textAlign: "center",
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
  },
} satisfies Record<string, CSSProperties | ((...args: never[]) => CSSProperties)>;
