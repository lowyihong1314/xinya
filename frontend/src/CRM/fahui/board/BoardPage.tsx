import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";

import { API_BASE } from "../../../js/apiBase";
import { useUserState } from "../../../app/UserState";
import { useOptionalAppChrome } from "../../../router/AppChromeContext";
import { YlpOrderSummaryDrawer } from "../YlpOrderSummaryDrawer";
import { getUserPermissionNames } from "../../../app/permissions";
import { copyTextToClipboard } from "../../../js/browserActions";
import { showConfirmDialog } from "../../../js/dialogs";
import { show_alert } from "../../../js/show_alert";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { connectFahuiSocket } from "../socket";
import { fetchYlpVersions } from "../api";
import {
  attachPdfToBoard,
  clearUnattachedPdfs,
  createBoard,
  createBoardTerminalLink,
  deleteBoard,
  deleteBoardEntry,
  getPrintPdf,
  listBoards,
  listUnattachedPdfs,
  quickSearchBoards,
  reorderBoardEntry,
  resetYearBarcodes,
  sendBoardHighlight,
  updateBoard,
  type Board,
  type BoardHighlightHit,
  type BoardSearchItem,
  type BoardSearchOrder,
  type UnattachedPdf,
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
  const { user, isMobile } = useUserState();
  const navigate = useNavigate();
  // 抽屉是 sticky 贴顶的，要把导航条让出来（和法会订单页那边一致）
  const navbarHeight = useOptionalAppChrome()?.navbarHeight ?? 60;
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

  // 拖动来源：板上重排（slot）或从「未上板」面板拖入（pool）。
  type DragState = { kind: "slot"; boardId: number; pdfId: number } | { kind: "pool"; pdfId: number };
  const [dragging, setDragging] = useState<DragState | null>(null);
  // 拖动悬停的目标「位置」（按格子的固定位号），用于实时预览插入后的排布。
  const [dragOver, setDragOver] = useState<{ boardId: number; location: number } | null>(null);
  // 被拖的 slot 元素不参与 FLIP（拖影由浏览器渲染，动它会取消拖拽）。
  const draggingSideIdRef = useRef<number | null>(null);

  // FLIP：slot 卡片因预览重排/落位换位置时，从旧布局位置平滑滑到新布局位置。
  // 先清掉动画残留的 transform 再量「干净」坐标，避免动画中途重测把中间位置当基准（会闪烁）。
  const slotRefs = useRef(new Map<number, HTMLDivElement>());
  const prevSlotRects = useRef(new Map<number, DOMRect>());
  useLayoutEffect(() => {
    const els = slotRefs.current;
    els.forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "";
    });
    const cleanRects = new Map<number, DOMRect>();
    els.forEach((el, key) => {
      cleanRects.set(key, el.getBoundingClientRect());
    });
    cleanRects.forEach((rect, key) => {
      const old = prevSlotRects.current.get(key);
      const el = els.get(key);
      if (!old || !el || key === draggingSideIdRef.current) {
        return;
      }
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)";
          el.style.transform = "";
        });
      }
    });
    prevSlotRects.current = cleanRects;
  });

  // ---- 未上板牌位（拖入看板即可上板） ----
  const POOL_PER_PAGE = 12;
  const [poolOpen, setPoolOpen] = useState(true);
  const [poolFullscreen, setPoolFullscreen] = useState(false);
  // 收到广播时在标题旁边闪一下「谁刚上板」
  const [liveHint, setLiveHint] = useState("");
  // 右键菜单（暂时只有「查看明细」）和它拉起的订单摘要抽屉
  const [poolMenu, setPoolMenu] = useState<{ pdfId: number; orderId: number | null; x: number; y: number } | null>(null);
  const [summaryOrderId, setSummaryOrderId] = useState<number | null>(null);
  // 牌位预览图后端存了磁盘缓存、浏览器又压了 30 天，订单改完必须两头一起破：
  // 这里按牌位单号记一个自增号，带进 URL（换 URL 破浏览器缓存）并带 refresh=1（破磁盘缓存）。
  const [previewNonce, setPreviewNonce] = useState<Record<number, number>>({});
  const [poolItems, setPoolItems] = useState<UnattachedPdf[]>([]);
  const [poolPage, setPoolPage] = useState(1);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolLoading, setPoolLoading] = useState(false);
  const poolPages = Math.max(1, Math.ceil(poolTotal / POOL_PER_PAGE));

  async function loadPool(page = poolPage) {
    setPoolLoading(true);
    try {
      const res = await listUnattachedPdfs(version, page, POOL_PER_PAGE);
      setPoolItems(res.items || []);
      setPoolTotal(res.pagination?.total || 0);
      setPoolPage(res.pagination?.page || page);
    } catch {
      setPoolItems([]);
      setPoolTotal(0);
    } finally {
      setPoolLoading(false);
    }
  }

  useEffect(() => {
    setPoolPage(1);
    void loadPool(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    if (!poolMenu) return;
    const close = () => setPoolMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [poolMenu]);

  /** 未上板的一张牌位。全屏和常规面板共用：
   *  常规面板管拖（拖到右边看板即上板），全屏管看（右键出菜单）。 */
  function renderPoolTile(pdf: UnattachedPdf, opts: { draggable: boolean; contextMenu: boolean; large?: boolean }) {
    const caption = pdf.orders.length
      ? pdf.orders
          .map((o) => (o.customer_name || `#${o.order_id}`) + (o.owner_or_deceased ? ` · ${o.owner_or_deceased}` : ""))
          .join("；")
      : `单号 #${pdf.id}`;
    const isDragged = dragging?.kind === "pool" && dragging.pdfId === pdf.id;
    return (
      <div
        key={pdf.id}
        className="ylp-pool-slot"
        style={{
          ...styles.slot,
          ...(isDragged ? styles.slotDragging : {}),
          ...(opts.large ? styles.poolSlotLarge : {}),
        }}
        draggable={opts.draggable && canEdit}
        onDragStart={opts.draggable ? () => onPoolDragStart(pdf.id) : undefined}
        onDragEnd={opts.draggable ? clearDrag : undefined}
        onContextMenu={
          opts.contextMenu
            ? (event) => {
                // 右键＝菜单，在光标处弹出，顺手压掉浏览器自带菜单
                event.preventDefault();
                // 关菜单的 window 监听已经挂上了，别让这次事件冒上去把刚开的菜单关掉
                event.stopPropagation();
                setPoolMenu({
                  pdfId: pdf.id,
                  orderId: pdf.orders[0]?.order_id ?? null,
                  x: event.clientX,
                  y: event.clientY,
                });
              }
            : undefined
        }
        title={caption}
      >
        <span style={styles.slotNo}>#{pdf.id}</span>
        <img
          src={previewUrl(pdf.id)}
          alt={`单号 ${pdf.id}`}
          style={styles.slotImg}
          loading="lazy"
          draggable={false}
        />
        <span style={styles.slotCap}>{caption}</span>
      </div>
    );
  }

  async function handleClearPool() {
    if (!poolTotal) return;
    const ok = await showConfirmDialog({
      message: `清空 ${version.replace("_YLP", "")} 年全部 ${poolTotal} 张未上板牌位单？空出的号码会在下次生成牌位时复用；需要时可重新打印生成。`,
      tone: "danger",
      confirmText: "清空",
    });
    if (!ok) return;
    setPoolLoading(true);
    try {
      const res = await clearUnattachedPdfs(version);
      show_alert("success", res.message || "已清空");
      await loadPool(1);
    } catch (e) {
      show_alert("error", e instanceof Error ? e.message : "清空失败");
      setPoolLoading(false);
    }
  }

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

  // 手机端扫码上板 / 别人在另一台电脑上拖动，这边实时跟着变。
  // 广播里只有 board_id + 动作，内容自己拉 —— 扫码一秒可能好几次，
  // 所以合并成 400ms 一次刷新，别把接口打爆。
  useEffect(() => {
    const socket = connectFahuiSocket();
    let timer: number | null = null;
    const refresh = (payload: { board_name?: string | null; action?: string; pdf_id?: number | null }) => {
      if (payload?.action === "attached" && payload.pdf_id) {
        setLiveHint(`牌位 ${payload.pdf_id} 刚上板${payload.board_name ? ` · ${payload.board_name}` : ""}`);
      } else if (payload?.action === "detached" && payload.pdf_id) {
        setLiveHint(`牌位 ${payload.pdf_id} 刚退板`);
      }
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        void reload();
        void loadPool();
      }, 400);
    };
    socket.on("fahui:board_changed", refresh);
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      socket.off("fahui:board_changed", refresh);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // 实时提示自己淡出
  useEffect(() => {
    if (!liveHint) {
      return;
    }
    const timer = window.setTimeout(() => setLiveHint(""), 3000);
    return () => window.clearTimeout(timer);
  }, [liveHint]);

  async function run(action: () => Promise<unknown>, okMsg?: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reload(); // 返回的 all_board 未按版本过滤，统一按当前版本重载
      void loadPool(); // 上板/摘板都会改变未上板池
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
    const nonce = previewNonce[pdfId];
    const query = nonce ? `?refresh=1&v=${nonce}` : "";
    const path = `/api/print_paiwei/print-pdfs/${pdfId}/preview-image${query}`;
    return API_BASE ? `${API_BASE}${path}` : path;
  }

  /** 某个订单改过之后，把它涉及的牌位预览全部标记为要重渲。
   *  只挑受影响的单号 —— 全量 refresh 等于让后端把满屏牌位重新渲一遍。 */
  function bumpPreviewsForOrder(orderId: number) {
    const affected = new Set<number>();
    poolItems.forEach((pdf) => {
      if ((pdf.orders || []).some((o) => o.order_id === orderId)) affected.add(pdf.id);
    });
    boards.forEach((board) => {
      (board.board_data || []).forEach((slot) => {
        if (slot.print_pdf_id && (slot.orders || []).some((o) => o.order_id === orderId)) {
          affected.add(slot.print_pdf_id);
        }
      });
    });
    if (!affected.size) return;
    setPreviewNonce((current) => {
      const next = { ...current };
      affected.forEach((id) => {
        next[id] = (next[id] || 0) + 1;
      });
      return next;
    });
  }

  function clearDrag() {
    draggingSideIdRef.current = null;
    setDragging(null);
    setDragOver(null);
  }

  function onSlotDragStart(board: Board, slot: { print_pdf_id?: number | null; side_id: number }) {
    if (!canEdit || !slot.print_pdf_id) return;
    const pdfId = slot.print_pdf_id;
    draggingSideIdRef.current = slot.side_id;
    // 延迟一拍再 setState：dragstart 当帧改被拖元素的样式会被 Chrome 取消拖拽。
    window.setTimeout(() => {
      setDragging({ kind: "slot", boardId: board.board_id, pdfId });
    }, 0);
  }

  function onPoolDragStart(pdfId: number) {
    if (!canEdit) return;
    window.setTimeout(() => {
      setDragging({ kind: "pool", pdfId });
    }, 0);
  }

  async function onSlotDrop(board: Board, targetLocation: number | null) {
    const src = dragging;
    clearDrag();
    if (!src) return;
    if (src.kind === "pool") {
      // 从未上板面板拖入：先贴板（落末位/空位），指定了格子就再挪到该位置。
      await run(async () => {
        await attachPdfToBoard({ board_id: board.board_id, pdf_id: src.pdfId });
        if (targetLocation != null) {
          await reorderBoardEntry({ board_id: board.board_id, pdf_id: src.pdfId, location: targetLocation });
        }
      }, `已贴到「${board.board_name}」`);
      void loadPool();
      return;
    }
    if (src.boardId !== board.board_id || !targetLocation) return;
    const from = board.board_data.find((s) => s.print_pdf_id === src.pdfId);
    if (!from || from.location === targetLocation) return;
    await run(() => reorderBoardEntry({ board_id: board.board_id, pdf_id: src.pdfId, location: targetLocation }));
  }

  // 预览排布：拖到某个位置时，按后端「插入挪位」的语义本地重排（卡片动、位号不动）。
  function previewSlots(board: Board, sorted: typeof board.board_data): typeof board.board_data {
    if (
      !dragging ||
      dragging.kind !== "slot" ||
      dragging.boardId !== board.board_id ||
      !dragOver ||
      dragOver.boardId !== board.board_id
    ) {
      return sorted;
    }
    const fromIdx = sorted.findIndex((s) => s.print_pdf_id === dragging.pdfId);
    const toIdx = sorted.findIndex((s) => s.location === dragOver.location);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
      return sorted;
    }
    const copy = [...sorted];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    return copy;
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
          {liveHint ? (
            <span style={styles.liveHint} className="ylp-board-live-hint">
              <i className="fa-solid fa-bolt" style={{ marginRight: 5 }} />
              {liveHint}
            </span>
          ) : null}
        </div>
        <div style={styles.headActions}>
          <select style={styles.versionSelect} value={version} onChange={(e) => setVersion(e.target.value)} title="版本（年份）">
            {versions.map((v) => (
              <option key={v} value={v}>
                {v.replace("_YLP", "")} 年
              </option>
            ))}
          </select>
          {/* 手机端扫码上板：拿手机对着板上的牌位扫，扫到直接贴 */}
          <button
            type="button"
            style={styles.primary}
            onClick={() => navigate("/crm/ylp_board_scan")}
            title="手机对着牌位扫二维码/条码直接上板"
          >
            <i className="fa-solid fa-qrcode" style={{ marginRight: 6 }} />
            注册看板手机端
          </button>
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

      {/* 看板列表（首卡：未上板牌位池，拖入任意看板即上板）。
          scroll-padding-left 扣掉 sticky 池子的宽度，吸附/定位不会滑到它底下被挡住。 */}
      <div
        style={{
          ...styles.boardGrid,
          scrollPaddingLeft: poolOpen ? "calc(min(88vw, 380px) + 14px)" : "58px",
        }}
      >
        {poolOpen ? (
          <div style={styles.poolCard} className="ylp-pool-card">
            <div style={styles.boardHead} className="ylp-pool-head">
              <div>
                <span style={styles.boardName}>未上板</span>
                <span style={styles.boardMeta}>{poolTotal} 张待贴 · 拖到右侧看板即可上板</span>
              </div>
              <div style={styles.boardActions} className="ylp-pool-actions">
                <button
                  type="button"
                  style={styles.tinyBtn}
                  onClick={() => setPoolFullscreen(true)}
                  title="全屏查看未上板预览"
                >
                  全屏
                </button>
                {canEdit && poolTotal > 0 ? (
                  <button type="button" style={styles.tinyDanger} onClick={() => void handleClearPool()} disabled={poolLoading}>
                    清空
                  </button>
                ) : null}
                <button type="button" style={styles.tinyBtn} onClick={() => setPoolOpen(false)}>收起</button>
              </div>
            </div>
            <div style={styles.poolGrid} className="ylp-pool-grid">
              {poolItems.map((pdf) => renderPoolTile(pdf, { draggable: true, contextMenu: false }))}
              {!poolLoading && !poolItems.length ? (
                <p style={{ ...styles.muted, gridColumn: "1 / -1" }}>本年牌位都已上板 🎉</p>
              ) : null}
            </div>
            <div style={styles.poolPager} className="ylp-pool-pager">
              <button
                type="button"
                style={styles.tinyBtn}
                disabled={poolLoading || poolPage <= 1}
                onClick={() => void loadPool(poolPage - 1)}
              >
                ‹ 上一页
              </button>
              <span style={styles.muted}>{poolLoading ? "加载中…" : `${poolPage} / ${poolPages}`}</span>
              <button
                type="button"
                style={styles.tinyBtn}
                disabled={poolLoading || poolPage >= poolPages}
                onClick={() => void loadPool(poolPage + 1)}
              >
                下一页 ›
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            style={styles.poolCollapsed}
            className="ylp-pool-collapsed"
            onClick={() => setPoolOpen(true)}
            title="展开未上板牌位"
          >
            <span style={styles.poolCollapsedText}>未上板 {poolTotal}</span>
          </button>
        )}
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
              onDragOver={(e: DragEvent) => {
                if (dragging?.kind === "pool") e.preventDefault();
              }}
              onDrop={() => {
                if (dragging?.kind === "pool") void onSlotDrop(board, null);
              }}
            >
              {board.board_data.length ? (
                (() => {
                  const sorted = [...board.board_data].sort((a, b) => (a.location ?? 0) - (b.location ?? 0));
                  const preview = previewSlots(board, sorted);
                  return preview.map((slot, idx) => {
                  // 格子的固定位号（卡片在预览中移动，位号钉在格子上）
                  const posLocation = sorted[idx]?.location ?? slot.location;
                  const caption = slot.orders.length
                    ? slot.orders
                        .map((o) => (o.customer_name || `#${o.order_id}`) + (o.owner_or_deceased ? ` · ${o.owner_or_deceased}` : ""))
                        .join("；")
                    : "空位";
                  const isDragged =
                    dragging?.kind === "slot" &&
                    dragging.pdfId === slot.print_pdf_id &&
                    dragging.boardId === board.board_id;
                  const isDropTarget = Boolean(
                    dragging && dragOver && dragOver.boardId === board.board_id && dragOver.location === posLocation,
                  );
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
                      ref={(el) => {
                        if (el) slotRefs.current.set(slot.side_id, el);
                        else slotRefs.current.delete(slot.side_id);
                      }}
                      id={boardSlotDomId(board.board_id, slot.location)}
                      className={isActive ? "board-slot-active" : undefined}
                      style={{
                        ...styles.slot,
                        ...(isDragged ? styles.slotDragging : {}),
                        ...(isDropTarget ? styles.slotDropTarget : {}),
                        ...(isHit ? styles.slotHit : {}),
                        ...(isActive ? styles.slotActive : {}),
                      }}
                      draggable={canEdit && !!slot.print_pdf_id}
                      onDragStart={() => onSlotDragStart(board, slot)}
                      onDragEnd={clearDrag}
                      onDragOver={(e: DragEvent) => {
                        const accepts =
                          dragging &&
                          (dragging.kind === "pool" ||
                            (dragging.kind === "slot" && dragging.boardId === board.board_id));
                        if (accepts) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOver((current) =>
                            current && current.boardId === board.board_id && current.location === posLocation
                              ? current
                              : posLocation != null
                                ? { boardId: board.board_id, location: posLocation }
                                : current,
                          );
                        }
                      }}
                      onDrop={(e: DragEvent) => {
                        e.stopPropagation();
                        void onSlotDrop(board, posLocation);
                      }}
                      title={caption}
                    >
                      <span style={styles.slotNo}>{posLocation ?? "-"}</span>
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
                  });
                })()
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

      {/* 未上板牌位的右键菜单：fixed 定位在光标处，暂时只有「查看明细」 */}
      {poolMenu ? (
        <div
          style={{ ...styles.poolMenu, left: `${poolMenu.x}px`, top: `${poolMenu.y}px` }}
          className="ylp-pool-menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            style={{ ...styles.poolMenuItem, ...(poolMenu.orderId ? null : styles.poolMenuItemDisabled) }}
            disabled={!poolMenu.orderId}
            onClick={() => {
              if (poolMenu.orderId) setSummaryOrderId(poolMenu.orderId);
              setPoolMenu(null);
            }}
          >
            查看明细
          </button>
          {!poolMenu.orderId ? <span style={styles.poolMenuHint}>这张牌位没有关联订单</span> : null}
        </div>
      ) : null}

      {/* 全屏看未上板：只看不拖（板都被盖住了），右键菜单照常 */}
      {poolFullscreen ? (
        <div style={styles.poolFullscreen} className="ylp-pool-fullscreen">
          <div style={styles.poolFullscreenBar}>
            <div>
              <span style={styles.boardName}>未上板</span>
              <span style={styles.boardMeta}>{`${poolTotal} 张待贴 · 第 ${poolPage} / ${poolPages} 页 · 右键牌位看明细`}</span>
            </div>
            <div style={styles.boardActions}>
              <button
                type="button"
                style={styles.tinyBtn}
                disabled={poolLoading || poolPage <= 1}
                onClick={() => void loadPool(poolPage - 1)}
              >
                ‹ 上一页
              </button>
              <button
                type="button"
                style={styles.tinyBtn}
                disabled={poolLoading || poolPage >= poolPages}
                onClick={() => void loadPool(poolPage + 1)}
              >
                下一页 ›
              </button>
              <button
                type="button"
                style={styles.tinyBtn}
                onClick={() => {
                  setPoolFullscreen(false);
                  setSummaryOrderId(null);
                  setPoolMenu(null);
                }}
              >
                退出全屏
              </button>
            </div>
          </div>
          <div
            style={{
              ...styles.poolFullscreenBody,
              flexDirection: isMobile ? "column" : "row",
              overflowY: isMobile ? "auto" : "hidden",
            }}
          >
            <div style={styles.poolFullscreenGrid} className="ylp-pool-fullscreen-grid">
              {poolItems.map((pdf) => renderPoolTile(pdf, { draggable: false, contextMenu: true, large: true }))}
              {!poolLoading && !poolItems.length ? (
                <p style={{ ...styles.muted, gridColumn: "1 / -1" }}>本年牌位都已上板 🎉</p>
              ) : null}
            </div>

            {/* 订单摘要抽屉：和法会订单页、原始文档页共用同一只。
                贴在全屏容器里而不是页面上 —— 全屏层是 fixed 的，抽屉挂外面会被它盖掉。
                navbarHeight 传 0：全屏里没有导航条，不用给它让位置。 */}
            {summaryOrderId != null ? (
              <YlpOrderSummaryDrawer
                orderId={summaryOrderId}
                isMobile={isMobile}
                navbarHeight={0}
                onClose={() => setSummaryOrderId(null)}
                onOpenDetail={(id) => {
                  setSummaryOrderId(null);
                  setPoolFullscreen(false);
                  navigate(`/crm/dharma_event?fahui_view=ylp_order&fahui_workspace=ylp&fahui_order_id=${id}`);
                }}
                onChanged={() => {
                  // 改完订单，牌位图就旧了：破掉这几张的缓存并重新拉列表
                  bumpPreviewsForOrder(summaryOrderId);
                  void loadPool();
                  void reload();
                }}
              />
            ) : null}
          </div>
        </div>
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
  // 未上板牌位池：固定在容器左侧首位（sticky），拖到右侧看板即上板
  poolCard: {
    flex: "0 0 auto",
    width: "min(88vw, 380px)",
    height: "100%",
    boxSizing: "border-box",
    position: "sticky",
    left: 0,
    zIndex: 3,
    scrollSnapAlign: "start",
    background: "var(--x-color-panel)",
    borderRadius: "var(--x-radius-md)",
    border: "1px dashed var(--x-color-accent-border)",
    boxShadow: "0 12px 30px var(--x-color-shadow)",
    padding: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  poolGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    alignContent: "start",
  },
  poolPager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  poolCollapsed: {
    flex: "0 0 auto",
    width: "44px",
    height: "100%",
    boxSizing: "border-box",
    position: "sticky",
    left: 0,
    zIndex: 3,
    borderRadius: "var(--x-radius-md)",
    border: "1px dashed var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // 未上板：全屏预览、右键菜单
  poolSlotLarge: { padding: "8px" } as CSSProperties,
  poolFullscreen: {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    display: "flex",
    flexDirection: "column" as const,
    background: "var(--x-color-canvas)",
  } as CSSProperties,
  poolFullscreenBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap" as const,
    padding: "10px 14px",
    borderBottom: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
  } as CSSProperties,
  // 全屏里网格和抽屉并排；手机上竖着叠（见 JSX），不然抽屉一占 100% 宽网格就被挤没了
  poolFullscreenBody: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px",
  } as CSSProperties,
  poolFullscreenGrid: {
    flex: 1,
    minWidth: 0,
    maxHeight: "100%",
    overflowY: "auto" as const,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "12px",
    alignContent: "start",
  } as CSSProperties,
  poolMenu: {
    position: "fixed",
    zIndex: 9500,
    minWidth: "140px",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    boxShadow: "0 12px 32px var(--x-color-shadow)",
    display: "grid",
    gap: "2px",
  } as CSSProperties,
  poolMenuItem: {
    textAlign: "left" as const,
    padding: "7px 10px",
    borderRadius: "6px",
    border: "none",
    background: "transparent",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  } as CSSProperties,
  poolMenuItemDisabled: { opacity: 0.45, cursor: "not-allowed" } as CSSProperties,
  poolMenuHint: { padding: "0 10px 6px", fontSize: "11px", color: "var(--x-color-ink-muted)" } as CSSProperties,
  liveHint: {
    display: "inline-flex",
    alignItems: "center",
    marginTop: "4px",
    padding: "3px 10px",
    borderRadius: "999px",
    background: "var(--x-color-success-soft)",
    color: "var(--x-color-success)",
    fontSize: "12px",
    fontWeight: 700,
  } as CSSProperties,
  poolCollapsedText: {
    writingMode: "vertical-rl",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "2px",
  },
  slot: { position: "relative", display: "flex", flexDirection: "column", gap: "4px", padding: "6px", borderRadius: "8px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", minWidth: 0, cursor: "grab" },
  slotDragging: { opacity: 0.35, scale: "0.96" },
  slotDropTarget: { border: "2px dashed var(--x-color-accent)", background: "var(--x-color-accent-soft)" },
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
