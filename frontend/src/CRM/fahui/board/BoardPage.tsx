import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { useUserState } from "../../../app/UserState";
import { getUserPermissionNames } from "../../../app/permissions";
import { showConfirmDialog } from "../../../js/dialogs";
import { show_alert } from "../../../js/show_alert";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import {
  attachPdfToBoard,
  createBoard,
  deleteBoard,
  deleteBoardEntry,
  getPrintPdf,
  listBoards,
  quickSearchBoards,
  reorderBoardEntry,
  updateBoard,
  type Board,
  type BoardSearchItem,
  type BoardSearchOrder,
} from "./api";

function ownerText(item: BoardSearchItem): string {
  const grouped = item?.item_form_data || {};
  const pick = (k: string) => (grouped[k] || []).map((v) => String(v?.val || "").trim()).filter(Boolean).join("、");
  return pick("owner") || pick("deceased") || "";
}

export function BoardPage() {
  useEnsureDesignTokens();
  const { user } = useUserState();
  const canEdit = useMemo(() => getUserPermissionNames(user).has("account_edit"), [user]);

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState("");
  const [newRow, setNewRow] = useState("10"); // 每行张数
  const [newForm, setNewForm] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<BoardSearchOrder[] | null>(null);
  const [pdfLookup, setPdfLookup] = useState<{ id: number; boards: { board_name?: string | null; location?: number | null }[] } | null>(null);
  const [searching, setSearching] = useState(false);

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const res = await listBoards();
      setBoards(res.all_board || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  function applyResult(all: Board[] | undefined) {
    if (all) setBoards(all);
  }

  async function run(action: () => Promise<{ all_board?: Board[] } | void>, okMsg?: string) {
    setBusy(true);
    setError("");
    try {
      const res = (await action()) as { all_board?: Board[] } | undefined;
      applyResult(res?.all_board);
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
    await run(() => createBoard({ board_name: name, board_width: perRow }), "已新建看板");
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

  async function handleReorder(board: Board, pdfId: number | null | undefined, location: number) {
    if (!pdfId) return;
    await run(() => reorderBoardEntry({ board_id: board.board_id, pdf_id: pdfId, location }));
  }

  async function handleRemoveSlot(sideId: number) {
    const ok = await showConfirmDialog({ message: "从看板移除这个位置？", tone: "danger" });
    if (!ok) return;
    await run(() => deleteBoardEntry(sideId));
  }

  async function handleSearch() {
    const kw = keyword.trim();
    setSearchResults(null);
    setPdfLookup(null);
    if (!kw) return;
    setSearching(true);
    try {
      const res = await quickSearchBoards(kw);
      setSearchResults(res.results || []);
      // 纯数字也当牌位单号查一次板位
      if (/^\d+$/.test(kw)) {
        try {
          const p = await getPrintPdf(Number(kw));
          if (p.data) setPdfLookup({ id: p.data.id, boards: p.data.boards || [] });
        } catch {
          /* 单号不存在则忽略 */
        }
      }
    } catch (e) {
      show_alert("error", e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section style={styles.page}>
      <header style={styles.head}>
        <div>
          <p style={styles.eyebrow}>盂兰盆法会</p>
          <h2 style={styles.title}>看板 · 牌位位置维护</h2>
        </div>
        <div style={styles.headActions}>
          <button type="button" style={styles.ghost} onClick={() => void reload()} disabled={busy}>刷新</button>
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
          <input style={styles.input} placeholder="牌位单号 / 订单号 / 功德主 / 阳上名 / 电话" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); }} />
          <button type="button" style={styles.primary} onClick={() => void handleSearch()} disabled={searching}>{searching ? "查询中…" : "查板"}</button>
        </div>
        {pdfLookup ? (
          <div style={styles.searchHit}>
            单号 #{pdfLookup.id}：{pdfLookup.boards.length ? pdfLookup.boards.map((b) => `${b.board_name} 第 ${b.location} 位`).join("；") : "尚未贴板"}
          </div>
        ) : null}
        {searchResults ? (
          searchResults.length ? (
            <div style={styles.stack}>
              {searchResults.map((order) => (
                <div key={order.id} style={styles.searchOrder}>
                  <div style={styles.searchOrderTop}>订单 #{order.id} · {order.customer_name || order.name || "-"}</div>
                  {(order.order_items || []).map((item) => {
                    const boards = (item.item_location || []).flatMap((loc) => loc.boards || []);
                    return (
                      <div key={item.id} style={styles.searchItem}>
                        <span>{item.item_name || item.code} {ownerText(item) ? `· ${ownerText(item)}` : ""}</span>
                        <span style={boards.length ? styles.locOn : styles.locOff}>
                          {boards.length ? boards.map((b) => `${b?.board_name} 第 ${b?.location} 位`).join("；") : "未上板"}
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
                board.board_data.map((slot) => (
                  <div key={slot.side_id} style={styles.slot}>
                    <span style={styles.slotNo}>{slot.location ?? "-"}</span>
                    <div style={styles.slotBody}>
                      {slot.orders.length ? (
                        slot.orders.map((o) => (
                          <span key={o.order_item_id ?? o.order_id} style={styles.slotOrder}>
                            {o.customer_name || `订单 #${o.order_id}`}
                            {o.owner_or_deceased ? ` · ${o.owner_or_deceased}` : ""}
                          </span>
                        ))
                      ) : (
                        <span style={styles.muted}>空位</span>
                      )}
                      <span style={styles.slotPdf}>单号 #{slot.print_pdf_id ?? "-"}</span>
                    </div>
                    {canEdit ? (
                      <div style={styles.slotActions}>
                        <input
                          style={styles.locInput}
                          type="number"
                          min={1}
                          defaultValue={slot.location ?? undefined}
                          title="移动到第几位"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const v = Number((e.target as HTMLInputElement).value);
                              if (Number.isFinite(v) && v > 0) void handleReorder(board, slot.print_pdf_id, v);
                            }
                          }}
                        />
                        <button type="button" style={styles.tinyDanger} onClick={() => void handleRemoveSlot(slot.side_id)}>移除</button>
                      </div>
                    ) : null}
                  </div>
                ))
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
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: "14px", fontFamily: "var(--x-font-sans)", color: "var(--x-color-ink)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  eyebrow: { margin: 0, fontSize: "12px", fontWeight: 700, letterSpacing: "1px", color: "var(--x-color-accent)" },
  title: { margin: "3px 0 0", fontSize: "20px", fontWeight: 800 },
  headActions: { display: "flex", gap: "8px" },
  primary: { padding: "8px 14px", borderRadius: "8px", border: "none", background: "var(--x-color-accent)", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" },
  ghost: { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer" },
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
  boardGrid: { display: "flex", flexDirection: "column", gap: "14px" },
  boardCard: { background: "var(--x-color-panel)", borderRadius: "var(--x-radius-md)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 12px 30px var(--x-color-shadow-soft)", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" },
  boardHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" },
  boardName: { fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" },
  boardMeta: { display: "block", fontSize: "11.5px", color: "var(--x-color-ink-muted)", marginTop: "2px" },
  boardActions: { display: "flex", gap: "6px", flexShrink: 0 },
  tinyBtn: { padding: "4px 9px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", cursor: "pointer" },
  tinyDanger: { padding: "4px 9px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", cursor: "pointer" },
  slotList: { display: "flex", flexDirection: "column", gap: "6px" },
  slot: { display: "flex", flexDirection: "column", gap: "4px", padding: "8px", borderRadius: "8px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", minWidth: 0 },
  slotNo: { width: 24, height: 24, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 800, background: "var(--x-color-accent)", color: "#fff" },
  slotBody: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 },
  slotOrder: { fontSize: "12px", fontWeight: 600, color: "var(--x-color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  slotPdf: { fontSize: "10.5px", color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)" },
  slotActions: { display: "flex", alignItems: "center", gap: "6px" },
  locInput: { width: 48, boxSizing: "border-box", padding: "5px 6px", fontSize: "12px", borderRadius: "6px", border: "1px solid var(--x-color-line)", textAlign: "center" },
  attachRow: { display: "flex", gap: "8px" },
};
