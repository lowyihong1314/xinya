import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";

import { API_BASE } from "../../../js/apiBase";
import { useUserState } from "../../../app/UserState";
import { getUserPermissionNames } from "../../../app/permissions";
import { copyTextToClipboard } from "../../../js/browserActions";
import { showConfirmDialog } from "../../../js/dialogs";
import { show_alert } from "../../../js/show_alert";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { fetchYlpVersions } from "../api";
import {
  attachPdfToBoard,
  createBoard,
  createBoardTerminalLink,
  deleteBoard,
  deleteBoardEntry,
  getPrintPdf,
  listBoards,
  quickSearchBoards,
  reorderBoardEntry,
  resetYearBarcodes,
  sendBoardHighlight,
  updateBoard,
  type Board,
  type BoardHighlightHit,
  type BoardSearchItem,
  type BoardSearchOrder,
} from "./api";

// 一个订单的全部上板位置（可能多张牌位、多块板）；
// 同一张牌位单多个项目会落在同一格，按 板+位置 去重。
function collectOrderHits(order: BoardSearchOrder): BoardHighlightHit[] {
  const hits: BoardHighlightHit[] = [];
  const seen = new Set<string>();
  for (const item of order.order_items || []) {
    for (const loc of item.item_location || []) {
      for (const board of loc.boards || []) {
        if (board?.board_id && board?.location != null) {
          const key = `${board.board_id}:${board.location}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          hits.push({
            board_id: board.board_id,
            board_name: board.board_name,
            location: board.location,
            print_pdf_id: loc.print_pdf?.id ?? null,
          });
        }
      }
    }
  }
  return hits;
}

export type BoardHighlightState = {
  orderId: number | null;
  label: string;
  hits: BoardHighlightHit[];
  index: number;
};

export function boardSlotDomId(boardId: number, location: number | null): string {
  return `board-slot-${boardId}-${location ?? "x"}`;
}

// 线性位置 → 「第 x 排 第 y 位」（按该板的每行张数换算；没设每行时退回「第 n 位」）。
export function formatBoardLocation(
  boards: Board[],
  boardId?: number | null,
  location?: number | null,
): string {
  if (location == null) {
    return "-";
  }
  const width = boards.find((b) => b.board_id === boardId)?.board_width || 0;
  if (width > 0) {
    const row = Math.floor((location - 1) / width) + 1;
    const col = ((location - 1) % width) + 1;
    return `第 ${row} 排 第 ${col} 位`;
  }
  return `第 ${location} 位`;
}

function ownerText(item: BoardSearchItem): string {
  const grouped = item?.item_form_data || {};
  const pick = (k: string) => (grouped[k] || []).map((v) => String(v?.val || "").trim()).filter(Boolean).join("、");
  return pick("owner") || pick("deceased") || "";
}

export function BoardPage() {
  useEnsureDesignTokens();
  const { user } = useUserState();
  const canEdit = useMemo(() => getUserPermissionNames(user).has("account_edit"), [user]);

  const CURRENT_VERSION = `${new Date().getFullYear()}_YLP`;
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState<string>(CURRENT_VERSION);

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newRow, setNewRow] = useState("10"); // 每行张数
  const [newForm, setNewForm] = useState(false);

  const [dragging, setDragging] = useState<{ boardId: number; pdfId: number } | null>(null);

  const [keyword, setKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<BoardSearchOrder[] | null>(null);
  const [pdfLookup, setPdfLookup] = useState<{ id: number; boards: { board_name?: string | null; location?: number | null }[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState<BoardHighlightState | null>(null);

  // 点亮变化时：本页滚动定位 + 同步到终端（第二显示器）。
  useEffect(() => {
    const active = highlight ? highlight.hits[highlight.index] : null;
    if (active) {
      document
        .getElementById(boardSlotDomId(active.board_id, active.location))
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
    sendBoardHighlight({
      order_id: highlight?.orderId ?? null,
      order_label: highlight?.label ?? null,
      hits: highlight?.hits ?? [],
      active_index: highlight?.index ?? 0,
      version,
    }).catch(() => {
      /* 终端没开也没关系 */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight]);

  function activateOrderHighlight(order: BoardSearchOrder) {
    const hits = collectOrderHits(order);
    if (!hits.length) {
      show_alert("error", `订单 #${order.id} 还没有牌位上板`);
      return;
    }
    setHighlight({
      orderId: order.id,
      label: `订单 #${order.id} · ${order.customer_name || order.name || "-"}`,
      hits,
      index: 0,
    });
    // 选中后收起搜索结果，把屏幕留给看板；再次聚焦输入框可重新展开。
    setSearchResults(null);
    setPdfLookup(null);
  }

  function stepHighlight(delta: number) {
    setHighlight((current) => {
      if (!current || !current.hits.length) {
        return current;
      }
      const next = (current.index + delta + current.hits.length) % current.hits.length;
      return { ...current, index: next };
    });
  }

  async function handleCopyTerminalLink() {
    try {
      const res = await createBoardTerminalLink();
      if (!res.token) {
        show_alert("error", res.message || "生成终端链接失败");
        return;
      }
      const url = `${window.location.origin}/#/ylp-board-terminal?token=${res.token}`;
      const days = Math.max(1, Math.round((res.expires_in || 0) / 86400));
      try {
        await copyTextToClipboard(url);
        show_alert("success", `终端链接已复制（${days} 天内有效），在第二显示器打开即可联动`);
      } catch {
        show_alert("error", `自动复制失败，请手动复制：${url}`);
      }
    } catch (e) {
      show_alert("error", e instanceof Error ? e.message : "生成终端链接失败");
    }
  }

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const res = await listBoards(version);
      setBoards(res.all_board || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  // 版本列表（含当前年份，即使还没订单也可选）
  useEffect(() => {
    fetchYlpVersions()
      .then((res) => {
        const list = (res.data || []).filter(Boolean).filter((v) => v !== "DELETE");
        const merged = Array.from(new Set([CURRENT_VERSION, ...list]));
        setVersions(merged);
      })
      .catch(() => setVersions([CURRENT_VERSION]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 版本切换即重载
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function run(action: () => Promise<unknown>, okMsg?: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reload(); // 返回的 all_board 未按版本过滤，统一按当前版本重载
      if (okMsg) show_alert("success", okMsg);
    } catch (e) {
      show_alert("error", e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const perRow = Number(String(newRow).replace(/\D/g, "")) || null;
    await run(() => createBoard({ board_name: name, board_width: perRow, version }), "已新建看板");
    setNewName("");
    setNewForm(false);
  }

  async function handleRename(board: Board) {
    const name = window.prompt("看板名称", board.board_name);
    if (name == null) return;
    await run(() => updateBoard(board.board_id, { board_name: name.trim() }));
  }

  async function handleSetPerRow(board: Board) {
    const raw = window.prompt("每行张数（一行贴几张牌位）", String(board.board_width ?? ""));
    if (raw == null) return;
    const perRow = Number(String(raw).replace(/\D/g, ""));
    await run(() => updateBoard(board.board_id, { board_width: perRow > 0 ? perRow : null }));
  }

  async function handleDeleteBoard(board: Board) {
    const ok = await showConfirmDialog({ message: `确认删除看板「${board.board_name}」？板上 ${board.board_data.length} 个位置会一并移除（牌位记录保留）。`, tone: "danger" });
    if (!ok) return;
    await run(() => deleteBoard(board.board_id), "已删除看板");
  }

  async function handleAttach(board: Board, pdfIdRaw: string) {
    const pdfId = Number(String(pdfIdRaw).replace(/\D/g, ""));
    if (!Number.isFinite(pdfId) || pdfId <= 0) {
      show_alert("error", "请输入正确的牌位单号");
      return;
    }
    await run(() => attachPdfToBoard({ board_id: board.board_id, pdf_id: pdfId }), `已贴到「${board.board_name}」`);
  }

  function previewUrl(pdfId: number): string {
    const path = `/api/print_paiwei/print-pdfs/${pdfId}/preview-image`;
    return API_BASE ? `${API_BASE}${path}` : path;
  }

  function onSlotDragStart(board: Board, pdfId: number | null | undefined) {
    if (!canEdit || !pdfId) return;
    setDragging({ boardId: board.board_id, pdfId });
  }

  async function onSlotDrop(board: Board, targetLocation: number | null) {
    const src = dragging;
    setDragging(null);
    if (!src || src.boardId !== board.board_id || !targetLocation) return;
    const from = board.board_data.find((s) => s.print_pdf_id === src.pdfId);
    if (!from || from.location === targetLocation) return;
    await run(() => reorderBoardEntry({ board_id: board.board_id, pdf_id: src.pdfId, location: targetLocation }));
  }

  async function handleRemoveSlot(sideId: number) {
    const ok = await showConfirmDialog({ message: "从看板移除这个位置？", tone: "danger" });
    if (!ok) return;
    await run(() => deleteBoardEntry(sideId));
  }

  const isCurrentYear = version === CURRENT_VERSION;

  async function handleResetYear() {
    const ok = await showConfirmDialog({
      message: `确认重置 ${version.replace("_YLP", "")} 年的所有条码/二维码？会清除该年已登记的牌位单号及其贴板位置（往年无法重置）。`,
      tone: "danger",
      confirmText: "重置",
    });
    if (!ok) return;
    await run(() => resetYearBarcodes(version), "已重置本年条码");
  }

  async function runBoardSearch(kw: string) {
    setSearching(true);
    try {
      const res = await quickSearchBoards(kw, version);
      setSearchResults(res.results || []);
      // 纯数字也当牌位单号查一次板位
      if (/^\d+$/.test(kw)) {
        try {
          const p = await getPrintPdf(Number(kw));
          if (p.data) setPdfLookup({ id: p.data.id, boards: p.data.boards || [] });
        } catch {
          setPdfLookup(null);
        }
      } else {
        setPdfLookup(null);
      }
    } catch (e) {
      show_alert("error", e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }

  // 输入即搜（防抖 350ms）；清空关键词时收起结果。
  useEffect(() => {
    const kw = keyword.trim();
    if (!kw) {
      setSearchResults(null);
      setPdfLookup(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runBoardSearch(kw);
    }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, version]);

  return (
    <section style={styles.page}>
      <header style={styles.head}>
        <div>
          <p style={styles.eyebrow}>盂兰盆法会</p>
          <h2 style={styles.title}>看板 · 牌位位置维护</h2>
        </div>
        <div style={styles.headActions}>
          <select style={styles.versionSelect} value={version} onChange={(e) => setVersion(e.target.value)} title="版本（年份）">
            {versions.map((v) => (
              <option key={v} value={v}>
                {v.replace("_YLP", "")} 年
              </option>
            ))}
          </select>
          <button type="button" style={styles.ghost} onClick={() => void reload()} disabled={busy}>刷新</button>
          <button type="button" style={styles.ghost} onClick={() => void handleCopyTerminalLink()} title="第二显示器打开，查板点亮联动">
            复制终端链接
          </button>
          {canEdit && isCurrentYear ? (
            <button type="button" style={styles.danger} onClick={() => void handleResetYear()} disabled={busy} title="只能重置当前年份">
              重置本年条码
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" style={styles.primary} onClick={() => setNewForm((v) => !v)}>+ 新建看板</button>
          ) : null}
        </div>
      </header>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {!canEdit ? <div style={styles.hintBox}>只读模式：需要 account_edit 权限才能维护看板。</div> : null}

      {newForm && canEdit ? (
        <div style={styles.card}>
          <div style={styles.inlineRow}>
            <input style={styles.input} placeholder="看板名称，如 RM15 冤亲债主_A" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }} />
            <input style={styles.numInput} type="number" min={1} placeholder="每行张数" value={newRow} onChange={(e) => setNewRow(e.target.value)} title="每行张数（一行贴几张）" />
            <button type="button" style={styles.primary} onClick={() => void handleCreate()} disabled={busy || !newName.trim()}>创建</button>
          </div>
        </div>
      ) : null}

      {/* 查板 */}
      <div style={styles.card}>
        <p style={styles.cardTitle}>查板</p>
        <div style={styles.inlineRow}>
          <input
            style={styles.input}
            placeholder="牌位单号 / 订单号 / 功德主 / 阳上名 / 电话（输入即搜）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onFocus={() => {
              const kw = keyword.trim();
              if (kw && searchResults == null) {
                void runBoardSearch(kw);
              }
            }}
          />
          {searching ? <span style={styles.muted}>查询中…</span> : null}
        </div>
        {pdfLookup ? (
          <div style={styles.searchHit}>
            单号 #{pdfLookup.id}：{pdfLookup.boards.length ? pdfLookup.boards.map((b) => `${b.board_name} ${formatBoardLocation(boards, (b as { board_id?: number | null }).board_id, b.location)}`).join("；") : "尚未贴板"}
          </div>
        ) : null}
        {searchResults ? (
          searchResults.length ? (
            <div style={styles.stack}>
              {searchResults.map((order) => (
                <div
                  key={order.id}
                  style={{
                    ...styles.searchOrder,
                    ...styles.searchOrderClickable,
                    ...(highlight?.orderId === order.id ? styles.searchOrderActive : null),
                  }}
                  onClick={() => activateOrderHighlight(order)}
                  title="点击点亮该订单的牌位位置（终端同步）"
                >
                  <div style={styles.searchOrderTop}>订单 #{order.id} · {order.customer_name || order.name || "-"}</div>
                  {(order.order_items || []).map((item) => {
                    const itemBoards = (item.item_location || []).flatMap((loc) => loc.boards || []);
                    return (
                      <div key={item.id} style={styles.searchItem}>
                        <span>{item.item_name || item.code} {ownerText(item) ? `· ${ownerText(item)}` : ""}</span>
                        <span style={itemBoards.length ? styles.locOn : styles.locOff}>
                          {itemBoards.length ? itemBoards.map((b) => `${b?.board_name} ${formatBoardLocation(boards, b?.board_id, b?.location)}`).join("；") : "未上板"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p style={styles.muted}>没有匹配的记录。</p>
          )
        ) : null}
      </div>

      {loading ? <p style={styles.muted}>加载中…</p> : null}

      {/* 看板列表 */}
      <div style={styles.boardGrid}>
        {boards.map((board) => (
          <div key={board.board_id} style={styles.boardCard}>
            <div style={styles.boardHead}>
              <div>
                <span style={styles.boardName}>{board.board_name}</span>
                <span style={styles.boardMeta}>
                  #{board.board_id} · {board.board_data.length} 位 · 每行 {board.board_width || "—"} 张
                </span>
              </div>
              {canEdit ? (
                <div style={styles.boardActions}>
                  <button type="button" style={styles.tinyBtn} onClick={() => void handleRename(board)}>改名</button>
                  <button type="button" style={styles.tinyBtn} onClick={() => void handleSetPerRow(board)}>每行</button>
                  <button type="button" style={styles.tinyDanger} onClick={() => void handleDeleteBoard(board)}>删板</button>
                </div>
              ) : null}
            </div>

            <div
              style={
                board.board_width && board.board_width > 0
                  ? { ...styles.slotList, display: "grid", gridTemplateColumns: `repeat(${board.board_width}, minmax(0, 1fr))` }
                  : styles.slotList
              }
            >
              {board.board_data.length ? (
                board.board_data.map((slot) => {
                  const caption = slot.orders.length
                    ? slot.orders
                        .map((o) => (o.customer_name || `#${o.order_id}`) + (o.owner_or_deceased ? ` · ${o.owner_or_deceased}` : ""))
                        .join("；")
                    : "空位";
                  const isDragged = dragging?.pdfId === slot.print_pdf_id && dragging?.boardId === board.board_id;
                  const isHit = Boolean(
                    highlight?.hits.some((h) => h.board_id === board.board_id && h.location === slot.location),
                  );
                  const activeHit = highlight ? highlight.hits[highlight.index] : null;
                  const isActive = Boolean(
                    activeHit && activeHit.board_id === board.board_id && activeHit.location === slot.location,
                  );
                  return (
                    <div
                      key={slot.side_id}
                      id={boardSlotDomId(board.board_id, slot.location)}
                      className={isActive ? "board-slot-active" : undefined}
                      style={{
                        ...styles.slot,
                        ...(isDragged ? styles.slotDragging : {}),
                        ...(isHit ? styles.slotHit : {}),
                        ...(isActive ? styles.slotActive : {}),
                      }}
                      draggable={canEdit && !!slot.print_pdf_id}
                      onDragStart={() => onSlotDragStart(board, slot.print_pdf_id)}
                      onDragEnd={() => setDragging(null)}
                      onDragOver={(e: DragEvent) => {
                        if (dragging && dragging.boardId === board.board_id) e.preventDefault();
                      }}
                      onDrop={() => void onSlotDrop(board, slot.location)}
                      title={caption}
                    >
                      <span style={styles.slotNo}>{slot.location ?? "-"}</span>
                      {canEdit ? (
                        <button
                          type="button"
                          style={styles.slotRemove}
                          onClick={() => void handleRemoveSlot(slot.side_id)}
                          aria-label="移除"
                        >
                          ✕
                        </button>
                      ) : null}
                      {slot.print_pdf_id ? (
                        <img src={previewUrl(slot.print_pdf_id)} alt={`单号 ${slot.print_pdf_id}`} style={styles.slotImg} loading="lazy" draggable={false} />
                      ) : (
                        <div style={styles.slotEmpty}>空位</div>
                      )}
                      <span style={styles.slotCap}>{caption}</span>
                    </div>
                  );
                })
              ) : (
                <p style={styles.muted}>这块板还没有贴牌位。</p>
              )}
            </div>

            {canEdit ? (
              <div style={styles.attachRow}>
                <input
                  style={styles.input}
                  placeholder="输入牌位单号贴到此板"
                  inputMode="numeric"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleAttach(board, (e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {!loading && !boards.length ? <p style={styles.muted}>还没有看板。{canEdit ? "点右上「新建看板」开始。" : ""}</p> : null}

      {/* 点亮导航条：多处位置时可逐个跳转，终端同步 */}
      {highlight ? (
        <>
          <style>{BOARD_HIGHLIGHT_CSS}</style>
          <div style={styles.highlightBar}>
            <span style={styles.highlightLabel}>{highlight.label}</span>
            <span style={styles.highlightLoc}>
              {highlight.hits[highlight.index]
                ? `${highlight.hits[highlight.index].board_name || `板 #${highlight.hits[highlight.index].board_id}`} ${formatBoardLocation(boards, highlight.hits[highlight.index].board_id, highlight.hits[highlight.index].location)}`
                : "-"}
            </span>
            {highlight.hits.length > 1 ? (
              <>
                <button type="button" style={styles.highlightNav} onClick={() => stepHighlight(-1)}>
                  ‹ 上一个
                </button>
                <span style={styles.highlightCount}>{`${highlight.index + 1} / ${highlight.hits.length}`}</span>
                <button type="button" style={styles.highlightNav} onClick={() => stepHighlight(1)}>
                  下一个 ›
                </button>
              </>
            ) : null}
            <button type="button" style={styles.highlightClose} onClick={() => setHighlight(null)} aria-label="关闭点亮">
              ✕
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

export const BOARD_HIGHLIGHT_CSS = `
@keyframes board-slot-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.85), 0 0 24px 6px rgba(245, 158, 11, 0.45); }
  50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.95), 0 0 36px 12px rgba(245, 158, 11, 0.6); }
}
.board-slot-active { animation: board-slot-pulse 1.1s ease-in-out infinite; }
`;

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: "14px", fontFamily: "var(--x-font-sans)", color: "var(--x-color-ink)", minWidth: 0, maxWidth: "100%" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  eyebrow: { margin: 0, fontSize: "12px", fontWeight: 700, letterSpacing: "1px", color: "var(--x-color-accent)" },
  title: { margin: "3px 0 0", fontSize: "20px", fontWeight: 800 },
  headActions: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" as const },
  versionSelect: { padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, fontSize: "13px", cursor: "pointer" },
  primary: { padding: "8px 14px", borderRadius: "8px", border: "none", background: "var(--x-color-accent)", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" },
  ghost: { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer" },
  danger: { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" },
  errorBox: { padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontSize: "13px" },
  hintBox: { padding: "8px 12px", borderRadius: "8px", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)", fontSize: "12px" },
  card: { background: "var(--x-color-panel)", borderRadius: "var(--x-radius-md)", border: "1px solid var(--x-color-line-soft)", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" },
  cardTitle: { margin: 0, fontSize: "14px", fontWeight: 800 },
  inlineRow: { display: "flex", gap: "8px" },
  input: { flex: 1, boxSizing: "border-box", padding: "10px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", outline: "none" },
  numInput: { width: 96, boxSizing: "border-box", padding: "10px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", outline: "none" },
  stack: { display: "flex", flexDirection: "column", gap: "8px" },
  muted: { margin: 0, fontSize: "12.5px", color: "var(--x-color-ink-muted)" },
  searchHit: { padding: "8px 12px", borderRadius: "8px", background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)", fontSize: "13px", fontWeight: 600 },
  searchOrder: { padding: "10px 12px", borderRadius: "8px", background: "var(--x-color-panel-alt)", display: "flex", flexDirection: "column", gap: "4px" },
  searchOrderTop: { fontSize: "13px", fontWeight: 700 },
  searchItem: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", fontSize: "12.5px" },
  locOn: { color: "var(--x-color-success)", fontWeight: 700, whiteSpace: "nowrap" },
  locOff: { color: "var(--x-color-ink-muted)", whiteSpace: "nowrap" },
  // 满屏高主容器：看板横向排布，左右滑动切换（scroll-snap 对齐）。
  boardGrid: {
    display: "flex",
    flexDirection: "row",
    gap: "14px",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    height: "calc(100vh - 150px)",
    overflowX: "auto",
    overflowY: "hidden",
    scrollSnapType: "x proximity",
    scrollBehavior: "smooth",
    paddingBottom: "8px",
  },
  boardCard: {
    flex: "0 0 auto",
    width: "min(94vw, 1000px)",
    height: "100%",
    boxSizing: "border-box",
    scrollSnapAlign: "start",
    background: "var(--x-color-panel)",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 12px 30px var(--x-color-shadow-soft)",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  boardHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" },
  boardName: { fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" },
  boardMeta: { display: "block", fontSize: "11.5px", color: "var(--x-color-ink-muted)", marginTop: "2px" },
  boardActions: { display: "flex", gap: "6px", flexShrink: 0 },
  tinyBtn: { padding: "4px 9px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", cursor: "pointer" },
  tinyDanger: { padding: "4px 9px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", cursor: "pointer" },
  slotList: { display: "flex", flexDirection: "column", gap: "6px", flex: 1, minHeight: 0, overflowY: "auto", alignContent: "start" },
  slot: { position: "relative", display: "flex", flexDirection: "column", gap: "4px", padding: "6px", borderRadius: "8px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", minWidth: 0, cursor: "grab" },
  slotDragging: { opacity: 0.4 },
  slotHit: { border: "2px solid rgba(245, 158, 11, 0.7)", background: "rgba(245, 158, 11, 0.1)" },
  slotActive: { border: "2px solid rgb(245, 158, 11)", background: "rgba(245, 158, 11, 0.18)", zIndex: 1 },
  searchOrderClickable: { cursor: "pointer", border: "1px solid transparent" },
  searchOrderActive: { border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-soft)" },
  highlightBar: { position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", zIndex: 900, display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "999px", background: "var(--x-color-ink)", color: "var(--x-color-panel)", boxShadow: "0 16px 40px rgba(0,0,0,0.35)", maxWidth: "min(94vw, 720px)" },
  highlightLabel: { fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "220px" },
  highlightLoc: { fontSize: "13px", fontWeight: 700, color: "rgb(245, 158, 11)", whiteSpace: "nowrap" },
  highlightNav: { padding: "6px 12px", borderRadius: "999px", border: "none", background: "rgba(255,255,255,0.16)", color: "inherit", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" },
  highlightCount: { fontSize: "12.5px", fontWeight: 700, opacity: 0.85, whiteSpace: "nowrap" },
  highlightClose: { width: 26, height: 26, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.16)", color: "inherit", cursor: "pointer", fontSize: "12px", flexShrink: 0 },
  slotNo: { position: "absolute", top: "5px", left: "5px", zIndex: 2, minWidth: 18, height: 18, padding: "0 5px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 800, background: "rgba(15,118,110,0.92)", color: "#fff" },
  slotRemove: { position: "absolute", top: "5px", right: "5px", zIndex: 2, width: 18, height: 18, borderRadius: "50%", border: "none", background: "rgba(194,65,12,0.92)", color: "#fff", cursor: "pointer", fontSize: "11px", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  slotImg: { width: "100%", height: "auto", display: "block", borderRadius: "4px", background: "#fff", aspectRatio: "3 / 4", objectFit: "contain" },
  slotEmpty: { width: "100%", aspectRatio: "3 / 4", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px", background: "var(--x-color-panel)", color: "var(--x-color-ink-muted)", fontSize: "12px", border: "1px dashed var(--x-color-line)" },
  slotCap: { fontSize: "10.5px", color: "var(--x-color-ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  attachRow: { display: "flex", gap: "8px" },
};
