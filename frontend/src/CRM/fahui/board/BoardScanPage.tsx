import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import jsQR from "jsqr";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { show_alert } from "../../../js/show_alert";
import { fetchYlpVersions } from "../api";
import { createBoard, deleteBoardEntry, listBoards, scanAttachToBoard } from "./api";
import type { Board, BoardScanResult } from "./api";

// 看板手机端：对着板上的牌位扫 QR / 条码，扫到就直接上板。
//
// 两屏：先选（或新建）一块板，进去之后摄像头一直开着实时扫。
// 扫到已经上板的会从顶部弹通知（后端拿 409 挡下来），镜头还对着那张时前端
// 会一直扫到同一个码 —— 所以每个码有 3 秒冷却，不然一秒能打十几次请求。
//
// 底下是本次扫上去的流水，每条都能一键退回未上板（扫错了当场撤）。

/** 同一个码多久之内不再发请求 */
const CODE_COOLDOWN_MS = 3000;
/** 每帧都解码太费电，隔几帧扫一次够用了 */
const SCAN_INTERVAL_MS = 220;
const TOAST_MS = 2600;

type ScanLog = {
  key: string;
  pdfId: number;
  sideId: number;
  label: string;
  at: string;
  rolledBack?: boolean;
};

type ToastTone = "ok" | "warn" | "info" | "bad";
type Toast = { id: number; tone: ToastTone; text: string; sub?: string };

// 扫的时候人是举着手机盯着板的，通知必须一眼看到：整条横幅、大字、颜色分明。
const TOAST_STYLE: Record<ToastTone, { bg: string; icon: string }> = {
  ok: { bg: "#15803d", icon: "fa-solid fa-circle-check" },       // 成功上板 —— 绿
  warn: { bg: "#d97706", icon: "fa-solid fa-triangle-exclamation" }, // 已经上板 —— 橙
  info: { bg: "#1d4ed8", icon: "fa-solid fa-rotate-left" },      // 已经退板 —— 蓝
  bad: { bg: "#be123c", icon: "fa-solid fa-circle-xmark" },      // 认不出 / 网络 —— 红
};

function ordersLabel(result: BoardScanResult): string {
  const orders = result.orders || [];
  if (!orders.length) {
    return `单号 #${result.pdf_id}`;
  }
  return orders
    .map((o) => (o.customer_name || `#${o.order_id}`) + (o.owner_or_deceased ? ` · ${o.owner_or_deceased}` : ""))
    .join("；");
}

const TOAST_CSS = `
@keyframes boardScanToast {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
`;

export function BoardScanPage() {
  useEnsureDesignTokens();

  const [version, setVersion] = useState("");
  const [versions, setVersions] = useState<string[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastCode, setLastCode] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  // 每个码上次发请求的时间：镜头一直对着同一张牌位，不冷却会疯狂打接口
  const cooldownRef = useRef<Map<string, number>>(new Map());
  const inflightRef = useRef(false);
  const detectorRef = useRef<{ detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> } | null>(null);

  const pushToast = useCallback((tone: ToastTone, text: string, sub?: string) => {
    const id = Date.now() + Math.random();
    // 只留最近 3 条，扫得快的时候不会糊满整个屏幕
    setToasts((current) => [...current.slice(-2), { id, tone, text, sub }]);
    if (navigator.vibrate) {
      navigator.vibrate(tone === "ok" ? 60 : [40, 60, 40]);
    }
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  useEffect(() => {
    fetchYlpVersions()
      .then((res) => {
        const list = res.data || [];
        setVersions(list);
        setVersion((current) => current || list[0] || "");
      })
      .catch(() => setVersions([]));
  }, []);

  const loadBoards = useCallback(async (targetVersion: string) => {
    setBoardsLoading(true);
    try {
      const res = await listBoards(targetVersion || undefined);
      setBoards(res.all_board || []);
    } catch {
      setBoards([]);
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoards(version);
  }, [version, loadBoards]);

  // ---- 摄像头 ----
  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const handleCode = useCallback(
    async (code: string, boardId: number) => {
      const now = Date.now();
      const last = cooldownRef.current.get(code) || 0;
      // 3 秒冷却：镜头没移开时同一个码会被连续识别到，这里挡掉重复请求
      if (now - last < CODE_COOLDOWN_MS || inflightRef.current) {
        return;
      }
      cooldownRef.current.set(code, now);
      inflightRef.current = true;
      setLastCode(code);
      try {
        const result = await scanAttachToBoard({ board_id: boardId, code });
        if (result.status === "attached") {
          pushToast("ok", `牌位 ${result.pdf_id} 成功上板`, ordersLabel(result));
          setLogs((current) => [
            {
              key: `${result.side_id}-${now}`,
              pdfId: result.pdf_id || 0,
              sideId: result.side_id || 0,
              label: ordersLabel(result),
              at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            },
            ...current,
          ]);
        } else if (result.status === "duplicate") {
          pushToast(
            "warn",
            `牌位 ${result.pdf_id} 已经上板`,
            result.same_board ? "就在这块板上" : `贴在「${result.board_name}」第 ${result.location} 位`,
          );
        } else {
          pushToast("bad", "认不出这个码", result.message || code.slice(0, 28));
        }
      } catch {
        pushToast("bad", "网络不通", "等一下再扫这张");
      } finally {
        inflightRef.current = false;
      }
    },
    [pushToast],
  );

  const startCamera = useCallback(
    async (target: Board) => {
      setCameraError("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("这个浏览器不支持摄像头，请用 Chrome / Safari 打开");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setCameraError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "没给摄像头权限。到浏览器设置里允许后重进这一页。"
            : "打不开摄像头，检查是不是被别的程序占用了",
        );
        return;
      }

      // 优先用浏览器原生的 BarcodeDetector：它认 Code128 条码，jsQR 只认 QR。
      // 牌位上两种都印了，所以退回 jsQR 也能扫，只是要对准左边那个二维码。
      const AnyWindow = window as unknown as { BarcodeDetector?: new (init?: unknown) => never };
      if (AnyWindow.BarcodeDetector) {
        try {
          detectorRef.current = new (AnyWindow.BarcodeDetector as unknown as new (init: {
            formats: string[];
          }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> })({
            formats: ["qr_code", "code_128", "code_39", "ean_13"],
          });
        } catch {
          detectorRef.current = null;
        }
      }

      setScanning(true);

      const tick = async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !streamRef.current) {
          return;
        }
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            let code = "";
            if (detectorRef.current) {
              try {
                const found = await detectorRef.current.detect(canvas);
                code = found[0]?.rawValue || "";
              } catch {
                detectorRef.current = null;
              }
            }
            if (!code) {
              const image = ctx.getImageData(0, 0, width, height);
              code = jsQR(image.data, width, height)?.data || "";
            }
            if (code) {
              void handleCode(code.trim(), target.board_id);
            }
          }
        }
        timerRef.current = window.setTimeout(() => {
          rafRef.current = window.requestAnimationFrame(() => void tick());
        }, SCAN_INTERVAL_MS);
      };
      rafRef.current = window.requestAnimationFrame(() => void tick());
    },
    [handleCode],
  );

  async function enterBoard(target: Board) {
    setBoard(target);
    setLogs([]);
    cooldownRef.current.clear();
    await startCamera(target);
  }

  function leaveBoard() {
    stopCamera();
    setBoard(null);
    setLastCode("");
    void loadBoards(version);
  }

  async function handleCreateBoard() {
    const name = newName.trim();
    if (!name) {
      show_alert("error", "先给看板起个名");
      return;
    }
    setCreating(true);
    try {
      const res = await createBoard({ board_name: name, version: version || undefined });
      const list = res.all_board || [];
      setBoards(list);
      setNewName("");
      const created = list.find((b) => b.board_name === name);
      if (created) {
        await enterBoard(created);
      }
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "新建看板失败");
    } finally {
      setCreating(false);
    }
  }

  async function rollback(log: ScanLog) {
    try {
      await deleteBoardEntry(log.sideId);
      setLogs((current) => current.map((one) => (one.key === log.key ? { ...one, rolledBack: true } : one)));
      // 退回未上板之后要能马上重扫，把冷却清掉
      cooldownRef.current.delete(String(log.pdfId));
      pushToast("info", `牌位 ${log.pdfId} 已经退板`, "回到未上板，可以重新扫");
    } catch (err) {
      pushToast("bad", err instanceof Error ? err.message : "退回失败");
    }
  }

  // ---- 第一屏：选板 / 新建 ----
  if (!board) {
    return (
      <section style={styles.page} className="board-scan-page">
        <header style={styles.head}>
          <div>
            <p style={styles.eyebrow}>YLP · 看板手机端</p>
            <h2 style={styles.title}>扫码上板</h2>
            <p style={styles.hint}>选一块板进去，摄像头会一直开着；扫到牌位上的二维码/条码就直接贴上去。</p>
          </div>
          <select value={version} onChange={(event) => setVersion(event.target.value)} style={styles.select}>
            {(versions.length ? versions : [version]).filter(Boolean).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </header>

        <div style={styles.createRow} className="board-scan-create">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="新建看板，例如「RM15 冤亲债主_C」"
            style={styles.input}
          />
          <button
            type="button"
            style={{ ...styles.primary, ...(creating ? styles.disabled : null) }}
            disabled={creating}
            onClick={() => void handleCreateBoard()}
          >
            {creating ? "建中…" : "新建并进入"}
          </button>
        </div>

        {boardsLoading ? <p style={styles.muted}>加载看板…</p> : null}
        {!boardsLoading && !boards.length ? <p style={styles.muted}>这个版本还没有看板，上面新建一块。</p> : null}

        <div style={styles.boardGrid} className="board-scan-boards">
          {boards.map((one) => {
            const filled = (one.board_data || []).filter((slot) => slot.print_pdf_id).length;
            return (
              <button key={one.board_id} type="button" style={styles.boardCard} onClick={() => void enterBoard(one)}>
                <span style={styles.boardName}>{one.board_name}</span>
                <span style={styles.boardMeta}>{`已贴 ${filled} 张`}</span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // ---- 第二屏：扫 ----
  const activeLogs = logs.filter((one) => !one.rolledBack);
  return (
    <section style={styles.scanPage} className="board-scan-live">
      <header style={styles.scanBar}>
        <button type="button" style={styles.ghost} onClick={leaveBoard}>
          ← 换板
        </button>
        <div style={styles.scanTitleWrap}>
          <span style={styles.scanTitle}>{board.board_name}</span>
          <span style={styles.scanMeta}>{scanning ? `本次已上板 ${activeLogs.length} 张` : "摄像头未开"}</span>
        </div>
      </header>

      <style>{TOAST_CSS}</style>
      <div style={styles.toasts} className="board-scan-toasts">
        {toasts.map((toast) => (
          <div key={toast.id} style={{ ...styles.toast, background: TOAST_STYLE[toast.tone].bg }}>
            <i className={TOAST_STYLE[toast.tone].icon} style={styles.toastIcon} />
            <div style={{ minWidth: 0 }}>
              <p style={styles.toastText}>{toast.text}</p>
              {toast.sub ? <p style={styles.toastSub}>{toast.sub}</p> : null}
            </div>
          </div>
        ))}
      </div>

      <div style={styles.videoWrap}>
        <video ref={videoRef} muted playsInline style={styles.video} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={styles.reticle} />
        {cameraError ? (
          <div style={styles.cameraError}>
            <p style={{ margin: 0 }}>{cameraError}</p>
            <button type="button" style={styles.primary} onClick={() => void startCamera(board)}>
              重试
            </button>
          </div>
        ) : null}
      </div>

      <p style={styles.lastCode}>{lastCode ? `刚扫到：${lastCode.slice(0, 40)}` : "把牌位上的二维码对准框内"}</p>

      <div style={styles.logList} className="board-scan-log">
        {activeLogs.length ? null : <p style={styles.muted}>还没扫到，扫上去的会列在这里，可以一键退回。</p>}
        {logs.map((log) => (
          <div key={log.key} style={{ ...styles.logRow, ...(log.rolledBack ? styles.logRowDone : null) }}>
            <div style={{ minWidth: 0 }}>
              <span style={styles.logPdf}>#{log.pdfId}</span>
              <span style={styles.logLabel}>{log.label}</span>
            </div>
            <span style={styles.logTime}>{log.at}</span>
            {log.rolledBack ? (
              <span style={styles.logDone}>已退回</span>
            ) : (
              <button type="button" style={styles.rollback} onClick={() => void rollback(log)}>
                退回
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "12px",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontFamily: '"PingFang SC","Microsoft YaHei",var(--x-font-sans)',
    alignContent: "start",
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" },
  eyebrow: { margin: 0, fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", color: "var(--x-color-accent-strong)" },
  title: { margin: "2px 0 0", fontSize: "20px", fontWeight: 800 },
  hint: { margin: "4px 0 0", fontSize: "12.5px", color: "var(--x-color-ink-muted)" },
  muted: { margin: 0, fontSize: "12.5px", color: "var(--x-color-ink-muted)" },
  select: {
    padding: "7px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
  },
  createRow: { display: "flex", gap: "8px", flexWrap: "wrap" },
  input: {
    flex: "1 1 200px",
    padding: "9px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "14px",
  },
  primary: {
    padding: "9px 16px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  ghost: {
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  boardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px" },
  boardCard: {
    display: "grid",
    gap: "4px",
    padding: "14px 12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    textAlign: "left",
    cursor: "pointer",
  },
  boardName: { fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" },
  boardMeta: { fontSize: "12px", color: "var(--x-color-ink-muted)" },

  scanPage: {
    position: "relative",
    display: "grid",
    gap: "8px",
    gridTemplateRows: "auto auto 1fr auto",
    minHeight: "calc(100vh - 90px)",
    padding: "10px",
    borderRadius: "10px",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontFamily: '"PingFang SC","Microsoft YaHei",var(--x-font-sans)',
  },
  scanBar: { display: "flex", alignItems: "center", gap: "10px" },
  scanTitleWrap: { display: "grid", minWidth: 0 },
  scanTitle: { fontSize: "16px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scanMeta: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  // 通知从顶部压在画面上方，扫的时候不用低头找
  toasts: {
    position: "absolute",
    top: "52px",
    left: "10px",
    right: "10px",
    zIndex: 20,
    display: "grid",
    gap: "6px",
    pointerEvents: "none",
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px 16px",
    borderRadius: "12px",
    color: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    animation: "boardScanToast 0.18s ease-out",
  },
  toastIcon: { fontSize: "26px", flexShrink: 0 },
  toastText: { margin: 0, fontSize: "19px", fontWeight: 900, lineHeight: 1.25 },
  toastSub: {
    margin: "2px 0 0",
    fontSize: "12.5px",
    opacity: 0.9,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  videoWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "3 / 4",
    maxHeight: "56vh",
    borderRadius: "12px",
    overflow: "hidden",
    background: "#000",
  },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  reticle: {
    position: "absolute",
    inset: "18% 12%",
    border: "2px solid rgba(255,255,255,0.85)",
    borderRadius: "12px",
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
    pointerEvents: "none",
  },
  cameraError: {
    position: "absolute",
    inset: 0,
    display: "grid",
    gap: "10px",
    placeContent: "center",
    padding: "20px",
    textAlign: "center",
    background: "rgba(0,0,0,0.7)",
    color: "#fff",
    fontSize: "13.5px",
  },
  lastCode: {
    margin: 0,
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
    fontFamily: "var(--x-font-mono)",
    textAlign: "center",
  },
  logList: { display: "grid", gap: "6px", overflowY: "auto", alignContent: "start" },
  logRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  logRowDone: { opacity: 0.5 },
  logPdf: { fontFamily: "var(--x-font-mono)", fontWeight: 800, marginRight: "6px" },
  logLabel: { fontSize: "13px" },
  logTime: { fontSize: "11px", color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)" },
  logDone: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  rollback: {
    padding: "5px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
};
