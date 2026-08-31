import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";

import { API_BASE } from "../../../js/apiBase";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { connectFahuiSocket } from "../socket";
import { BOARD_HIGHLIGHT_CSS, boardSlotDomId, formatBoardLocation } from "./BoardPage";
import { fetchTerminalBoards, type Board, type BoardHighlightPayload } from "./api";

type TerminalHighlight = {
  label: string;
  hits: BoardHighlightPayload["hits"];
  index: number;
};

export function BoardTerminalPage() {
  useEnsureDesignTokens();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token") || "";

  const [boards, setBoards] = useState<Board[]>([]);
  const [room, setRoom] = useState("");
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [highlight, setHighlight] = useState<TerminalHighlight | null>(null);
  const versionRef = useRef("");
  versionRef.current = version;

  const load = useCallback(async () => {
    if (!token) {
      setError("链接不完整，请在 CRM 看板页重新复制终端链接");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchTerminalBoards(token);
      setBoards(res.all_board || []);
      setRoom(res.room || "");
      setVersion(res.version || "");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // 联动通道：加入自己用户的终端房间，接收 CRM 查板的点亮指令。
  useEffect(() => {
    if (!room) {
      return;
    }
    const socket = connectFahuiSocket();
    const joinRoom = () => socket.emit("join_room", { room });
    socket.on("connect", () => {
      setConnected(true);
      joinRoom();
    });
    socket.on("disconnect", () => setConnected(false));
    if (socket.connected) {
      setConnected(true);
      joinRoom();
    }
    socket.on("fahui:board_highlight", (payload: BoardHighlightPayload) => {
      const hits = payload?.hits || [];
      if (!hits.length) {
        setHighlight(null);
        return;
      }
      // CRM 在别的年份查板时，先切到对应年份的大板再点亮。
      if (payload.version && payload.version !== versionRef.current) {
        void fetchTerminalBoards(token, payload.version)
          .then((res) => {
            setBoards(res.all_board || []);
            setVersion(res.version || payload.version || "");
          })
          .catch(() => {});
      }
      setHighlight({
        label: payload.order_label || (payload.order_id ? `订单 #${payload.order_id}` : "订单"),
        hits,
        index: Math.min(Math.max(payload.active_index || 0, 0), hits.length - 1),
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [room]);

  // 点亮变化或大板数据更新（跨年份切换）后滚动定位到对应位置。
  useEffect(() => {
    const active = highlight ? highlight.hits[highlight.index] : null;
    if (active) {
      document
        .getElementById(boardSlotDomId(active.board_id, active.location))
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }, [highlight, boards]);

  function stepHighlight(delta: number) {
    setHighlight((current) => {
      if (!current || !current.hits.length) {
        return current;
      }
      return { ...current, index: (current.index + delta + current.hits.length) % current.hits.length };
    });
  }

  function previewUrl(pdfId: number): string {
    const path = `/api/print_paiwei/print-pdfs/${pdfId}/preview-image`;
    return API_BASE ? `${API_BASE}${path}` : path;
  }

  const activeHit = highlight ? highlight.hits[highlight.index] : null;

  return (
    <div style={styles.page}>
      <style>{BOARD_HIGHLIGHT_CSS}</style>
      <header style={styles.head}>
        <div>
          <p style={styles.eyebrow}>盂兰盆法会 · 看板终端</p>
          <h1 style={styles.title}>{version ? `${version.replace("_YLP", "")} 年牌位大板` : "牌位大板"}</h1>
        </div>
        <div style={styles.headRight}>
          <span style={{ ...styles.connDot, background: connected ? "#22c55e" : "#f43f5e" }} />
          <span style={styles.connText}>{connected ? "联动中" : "未连接"}</span>
          <button type="button" style={styles.refreshBtn} onClick={() => void load()}>
            刷新
          </button>
        </div>
      </header>

      {loading ? <p style={styles.stateText}>加载中…</p> : null}
      {!loading && error ? <p style={{ ...styles.stateText, color: "#f87171" }}>{error}</p> : null}

      <div style={styles.boardStack}>
        {boards.map((board) => (
          <section key={board.board_id} style={styles.boardCard}>
            <header style={styles.boardHead}>
              <span style={styles.boardName}>{board.board_name}</span>
              <span style={styles.boardMeta}>{board.board_data.length} 位 · 每行 {board.board_width || "—"} 张</span>
            </header>
            <div
              style={
                board.board_width && board.board_width > 0
                  ? { ...styles.slotGrid, gridTemplateColumns: `repeat(${board.board_width}, minmax(0, 1fr))` }
                  : styles.slotGrid
              }
            >
              {board.board_data.map((slot) => {
                const isHit = Boolean(
                  highlight?.hits.some((h) => h.board_id === board.board_id && h.location === slot.location),
                );
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
                      ...(isHit ? styles.slotHit : {}),
                      ...(isActive ? styles.slotActive : {}),
                    }}
                  >
                    <span style={styles.slotNo}>{slot.location ?? "-"}</span>
                    {slot.print_pdf_id ? (
                      <img
                        src={previewUrl(slot.print_pdf_id)}
                        alt={`打印号(Barcode) ${slot.print_pdf_id}`}
                        style={styles.slotImg}
                        loading="lazy"
                        draggable={false}
                      />
                    ) : (
                      <div style={styles.slotEmpty}>空位</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {highlight ? (
        <div style={styles.highlightBar}>
          <span style={styles.highlightLabel}>{highlight.label}</span>
          <span style={styles.highlightLoc}>
            {activeHit
              ? `${activeHit.board_name || `板 #${activeHit.board_id}`} ${formatBoardLocation(boards, activeHit.board_id, activeHit.location)}`
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
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    width: "100%",
    boxSizing: "border-box",
    padding: "18px 22px 90px",
    background: "#0b1220",
    color: "#e2e8f0",
    fontFamily: "var(--x-font-sans, sans-serif)",
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "16px",
  },
  eyebrow: { margin: 0, fontSize: "13px", fontWeight: 700, letterSpacing: "1.5px", color: "#f59e0b" },
  title: { margin: "4px 0 0", fontSize: "26px", fontWeight: 900 },
  headRight: { display: "flex", alignItems: "center", gap: "8px" },
  connDot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block" },
  connText: { fontSize: "13px", fontWeight: 700, color: "#94a3b8" },
  refreshBtn: {
    marginLeft: "8px",
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid rgba(148, 163, 184, 0.4)",
    background: "transparent",
    color: "#e2e8f0",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  stateText: { margin: "20px 0", fontSize: "15px", color: "#94a3b8" },
  // 满屏高主容器：大板横向排布，点亮切换时左右滑动定位。
  boardStack: {
    display: "flex",
    flexDirection: "row",
    gap: "18px",
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
    display: "flex",
    flexDirection: "column",
    background: "rgba(15, 23, 42, 0.85)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: "14px",
    padding: "14px 16px",
  },
  boardHead: { display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "10px" },
  boardName: { fontSize: "19px", fontWeight: 900 },
  boardMeta: { fontSize: "12.5px", color: "#94a3b8" },
  slotGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
    gap: "6px",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    alignContent: "start",
  },
  slot: {
    position: "relative",
    borderRadius: "8px",
    padding: "4px",
    background: "rgba(30, 41, 59, 0.9)",
    border: "1px solid rgba(148, 163, 184, 0.16)",
    minWidth: 0,
  },
  slotHit: { border: "2px solid rgba(245, 158, 11, 0.7)", background: "rgba(245, 158, 11, 0.14)" },
  slotActive: { border: "2px solid rgb(245, 158, 11)", background: "rgba(245, 158, 11, 0.24)", zIndex: 1 },
  slotNo: {
    position: "absolute",
    top: "4px",
    left: "4px",
    zIndex: 2,
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: "999px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: 800,
    background: "rgba(15, 118, 110, 0.95)",
    color: "#fff",
  },
  slotImg: { width: "100%", height: "auto", display: "block", borderRadius: "4px", background: "#fff", aspectRatio: "3 / 4", objectFit: "contain" },
  slotEmpty: {
    width: "100%",
    aspectRatio: "3 / 4",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    color: "#64748b",
    fontSize: "12px",
    border: "1px dashed rgba(148, 163, 184, 0.3)",
  },
  highlightBar: {
    position: "fixed",
    left: "50%",
    bottom: "20px",
    transform: "translateX(-50%)",
    zIndex: 900,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 18px",
    borderRadius: "999px",
    background: "rgba(245, 158, 11, 0.96)",
    color: "#1c1917",
    boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
    maxWidth: "min(94vw, 780px)",
  },
  highlightLabel: { fontSize: "15px", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "300px" },
  highlightLoc: { fontSize: "15px", fontWeight: 800, whiteSpace: "nowrap" },
  highlightNav: {
    padding: "8px 14px",
    borderRadius: "999px",
    border: "none",
    background: "rgba(28, 25, 23, 0.14)",
    color: "inherit",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  highlightCount: { fontSize: "14px", fontWeight: 800, whiteSpace: "nowrap" },
};
