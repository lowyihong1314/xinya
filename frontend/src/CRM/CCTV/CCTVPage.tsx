import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { apiFetch } from "../../js/apiFetch";
import { API_BASE } from "../../js/apiBase";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";
import { hasUserPermission } from "../../app/permissions";
import "./vendor/videoRtcElement";

// go2rtc stream. WebRTC plays the raw (un-transcoded) H264 directly and tolerates the
// camera's long keyframe interval, unlike MSE. Signaling rides this WS (behind nginx
// auth); media flows over the go2rtc WebRTC port (8555).
function buildStreamWsUrl(): string {
  const base = API_BASE || window.location.origin;
  return base.replace(/^http/, "ws") + "/cctv_go2rtc/api/ws?src=cam1";
}

type VideoRtcEl = HTMLElement & {
  src: string;
  mode: string;
  background: boolean;
  video?: HTMLVideoElement | null;
};

type Mode = "live" | "playback";

type Recording = {
  name: string;
  start: string | null;
  duration: number | null;
  size: number;
  url: string;
};

const PTZ_SPEED = 0.4;

function ptzMove(x: number, y: number, z = 0) {
  void apiFetch("/api/move_camera/ptz/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y, z }),
  });
}

function ptzStop() {
  void apiFetch("/api/move_camera/ptz/stop", { method: "POST" });
}

export function CCTVPage() {
  useEnsureDesignTokens();
  const { user } = useUserState();
  const [mode, setMode] = useState<Mode>("live");

  if (!hasUserPermission(user, "cctv")) {
    return (
      <section style={styles.page}>
        <header style={styles.head}>
          <div>
            <p style={styles.eyebrow}>CCTV</p>
            <h2 style={styles.title}>监控</h2>
          </div>
        </header>
        <div style={styles.denied}>
          <p style={styles.deniedTitle}>权限不足</p>
          <p style={styles.deniedText}>你没有「监控 CCTV」权限，无法查看此页面。请联系管理员开通。</p>
        </div>
      </section>
    );
  }

  return (
    <section style={styles.page}>
      <header style={styles.head}>
        <div>
          <p style={styles.eyebrow}>CCTV</p>
          <h2 style={styles.title}>监控</h2>
        </div>
        <div style={styles.tabs}>
          <button type="button" style={{ ...styles.tab, ...(mode === "live" ? styles.tabOn : {}) }} onClick={() => setMode("live")}>
            直播
          </button>
          <button type="button" style={{ ...styles.tab, ...(mode === "playback" ? styles.tabOn : {}) }} onClick={() => setMode("playback")}>
            回放
          </button>
        </div>
      </header>

      {mode === "live" ? <LiveView /> : <PlaybackView />}
    </section>
  );
}

// ---- 播放器外壳：全屏容器 ----
function PlayerShell({
  children,
  wrapRef,
}: {
  children: ReactNode;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={wrapRef} style={styles.playerWrap}>
      {children}
    </div>
  );
}

function useFullscreen(ref: React.RefObject<HTMLDivElement | null>) {
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  }, [ref]);
  return { isFull, toggle };
}

// 覆盖层自动淡出：交互后 3 秒转为半透明
function useOverlayDim() {
  const [dim, setDim] = useState(false);
  const timerRef = useRef<number | null>(null);
  const poke = useCallback(() => {
    setDim(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setDim(true), 3000);
  }, []);
  useEffect(() => {
    poke();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [poke]);
  return { dim, poke };
}

function LiveView() {
  const elRef = useRef<VideoRtcEl | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const { isFull, toggle } = useFullscreen(wrapRef);
  const { dim, poke } = useOverlayDim();

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    setStatus("loading");
    el.background = false;
    el.mode = "webrtc"; // 原始流直连，不转码；媒体走 8555 (UDP，回退 TCP)
    el.src = buildStreamWsUrl();

    let raf = 0;
    let detach: (() => void) | null = null;
    const attach = () => {
      const v = el.video;
      if (!v) {
        raf = requestAnimationFrame(attach);
        return;
      }
      const onPlaying = () => setStatus("live");
      const onWaiting = () => setStatus((s) => (s === "live" ? s : "loading"));
      const onError = () => setStatus("error");
      v.addEventListener("playing", onPlaying);
      v.addEventListener("waiting", onWaiting);
      v.addEventListener("error", onError);
      if (!v.paused && v.readyState >= 2) setStatus("live");
      detach = () => {
        v.removeEventListener("playing", onPlaying);
        v.removeEventListener("waiting", onWaiting);
        v.removeEventListener("error", onError);
      };
    };
    attach();

    return () => {
      cancelAnimationFrame(raf);
      detach?.();
      try {
        el.src = "";
      } catch {
        /* noop */
      }
    };
  }, [reloadKey]);

  // 键盘云台：方向键移动、+/- 变焦，松开即停
  useEffect(() => {
    const KEYMAP: Record<string, [number, number, number]> = {
      ArrowUp: [0, PTZ_SPEED, 0],
      ArrowDown: [0, -PTZ_SPEED, 0],
      ArrowLeft: [-PTZ_SPEED, 0, 0],
      ArrowRight: [PTZ_SPEED, 0, 0],
      "+": [0, 0, PTZ_SPEED],
      "=": [0, 0, PTZ_SPEED],
      "-": [0, 0, -PTZ_SPEED],
    };
    const pressed = new Set<string>();
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const vec = KEYMAP[e.key];
      if (!vec) return;
      e.preventDefault();
      if (pressed.has(e.key)) return; // 忽略 auto-repeat
      pressed.add(e.key);
      poke();
      ptzMove(...vec);
    };
    const up = (e: KeyboardEvent) => {
      if (!pressed.delete(e.key)) return;
      if (!pressed.size) ptzStop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (pressed.size) ptzStop();
    };
  }, [poke]);

  const overlayOpacity = dim ? 0.35 : 1;

  return (
    <PlayerShell wrapRef={wrapRef}>
      <div
        style={{ position: "absolute", inset: 0 }}
        onMouseMove={poke}
        onTouchStart={poke}
      >
        <video-rtc-cctv ref={elRef} style={styles.video} />

        {/* 顶部信息条 */}
        <div style={{ ...styles.topBar, opacity: overlayOpacity }}>
          <span
            style={{
              ...styles.badge,
              ...(status === "live" ? styles.badgeLive : status === "error" ? styles.badgeErr : styles.badgeLoad),
            }}
          >
            {status === "live" ? "● 直播中" : status === "error" ? "连接失败" : "连接中…"}
          </span>
          <div style={styles.topActions}>
            {status === "error" ? (
              <button type="button" style={styles.glassBtn} onClick={() => setReloadKey((k) => k + 1)}>
                重连
              </button>
            ) : null}
            <button type="button" style={styles.glassBtn} onClick={toggle} title={isFull ? "退出全屏" : "全屏"}>
              {isFull ? "⤢ 退出全屏" : "⤢ 全屏"}
            </button>
          </div>
        </div>

        {status === "error" ? (
          <div style={styles.overlayMsg}>无法连接直播流，请点击右上角「重连」，或检查转流服务。</div>
        ) : null}

        {/* 云台摇杆：视频内右下角 */}
        <div style={{ ...styles.ptzCluster, opacity: overlayOpacity }} onMouseEnter={poke}>
          <div style={styles.zoomStack}>
            <PtzButton label="＋" title="放大（快捷键 +）" onPress={() => ptzMove(0, 0, PTZ_SPEED)} />
            <PtzButton label="－" title="缩小（快捷键 -）" onPress={() => ptzMove(0, 0, -PTZ_SPEED)} />
          </div>
          <div style={styles.dpad}>
            <div />
            <PtzButton label="▲" title="上（↑）" onPress={() => ptzMove(0, PTZ_SPEED)} />
            <div />
            <PtzButton label="◀" title="左（←）" onPress={() => ptzMove(-PTZ_SPEED, 0)} />
            <PtzButton label="■" title="停止" onPress={ptzStop} subtle />
            <PtzButton label="▶" title="右（→）" onPress={() => ptzMove(PTZ_SPEED, 0)} />
            <div />
            <PtzButton label="▼" title="下（↓）" onPress={() => ptzMove(0, -PTZ_SPEED)} />
            <div />
          </div>
        </div>

        <div style={{ ...styles.hintBar, opacity: dim ? 0 : 1 }}>
          按住方向键或摇杆移动镜头 · +/− 变焦 · 松开即停
        </div>
      </div>
    </PlayerShell>
  );
}

function PlaybackView() {
  const [items, setItems] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Recording | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { isFull, toggle } = useFullscreen(wrapRef);
  const { dim, poke } = useOverlayDim();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/move_camera/recordings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "加载失败");
      const list: Recording[] = data.items || [];
      setItems(list);
      setCurrent((prev) => (prev && list.some((r) => r.name === prev.name) ? prev : list[0] ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // items 最新在前；时间轴上的「上一段 / 下一段」
  const currentIndex = current ? items.findIndex((r) => r.name === current.name) : -1;
  const older = currentIndex >= 0 ? items[currentIndex + 1] ?? null : null;
  const newer = currentIndex > 0 ? items[currentIndex - 1] : null;

  // 按日期分组（浏览器本地时区）
  const groups = useMemo(() => {
    const out: { label: string; rows: Recording[] }[] = [];
    for (const r of items) {
      const label = dateLabel(r.start);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else out.push({ label, rows: [r] });
    }
    return out;
  }, [items]);

  const overlayOpacity = dim ? 0.35 : 1;

  return (
    <div style={styles.playbackWrap}>
      <div style={styles.playbackMain}>
        <PlayerShell wrapRef={wrapRef}>
          <div style={{ position: "absolute", inset: 0 }} onMouseMove={poke} onTouchStart={poke}>
            {current ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                key={current.name}
                src={current.url}
                style={styles.video}
                controls
                autoPlay
                playsInline
                onEnded={() => {
                  // 播完自动接下一段（时间轴向后）
                  if (newer) setCurrent(newer);
                }}
              />
            ) : (
              <div style={styles.overlayMsg}>{loading ? "加载录像…" : "暂无录像"}</div>
            )}

            <div style={{ ...styles.topBar, opacity: overlayOpacity, pointerEvents: "none" }}>
              <span style={{ ...styles.badge, ...styles.badgePlayback }}>
                {current ? `回放 · ${timeRangeLabel(current)}` : "回放"}
              </span>
              <div style={{ ...styles.topActions, pointerEvents: "auto" }}>
                {current ? (
                  <a href={current.url} download={current.name} style={styles.glassBtn}>
                    ⬇ 下载
                  </a>
                ) : null}
                <button type="button" style={styles.glassBtn} onClick={toggle}>
                  {isFull ? "⤢ 退出全屏" : "⤢ 全屏"}
                </button>
              </div>
            </div>

            {current ? (
              <div style={{ ...styles.segNav, opacity: overlayOpacity }}>
                <button
                  type="button"
                  style={{ ...styles.glassBtn, ...(older ? {} : styles.glassBtnDisabled) }}
                  disabled={!older}
                  onClick={() => older && setCurrent(older)}
                >
                  ⏮ 上一段
                </button>
                <button
                  type="button"
                  style={{ ...styles.glassBtn, ...(newer ? {} : styles.glassBtnDisabled) }}
                  disabled={!newer}
                  onClick={() => newer && setCurrent(newer)}
                >
                  下一段 ⏭
                </button>
              </div>
            ) : null}
          </div>
        </PlayerShell>
      </div>

      <aside style={styles.recList}>
        <div style={styles.recListHead}>
          <span style={styles.controlsTitle}>录像片段（{items.length}）</span>
          <button type="button" style={styles.refreshBtn} onClick={() => void load()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
        {error ? <p style={styles.recError}>{error}</p> : null}
        {!error && !loading && items.length === 0 ? <p style={styles.recEmpty}>暂无已保存的录像</p> : null}
        <div style={styles.recScroll}>
          {groups.map((g) => (
            <div key={g.label}>
              <div style={styles.recDateHead}>{g.label}</div>
              {g.rows.map((r) => (
                <button
                  type="button"
                  key={r.name}
                  style={{ ...styles.recItem, ...(current?.name === r.name ? styles.recItemOn : {}) }}
                  onClick={() => setCurrent(r)}
                >
                  <span style={styles.recTime}>{timeRangeLabel(r)}</span>
                  <span style={styles.recMeta}>
                    {r.duration ? `${Math.round(r.duration / 60)} 分钟 · ` : ""}
                    {fmtSize(r.size)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ---- 时间格式（浏览器本地时区；后端已带 UTC 时区标记） ----
function dateLabel(startIso: string | null): string {
  if (!startIso) return "未知日期";
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return "未知日期";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "今天";
  if (same(d, yesterday)) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function timeRangeLabel(r: Recording): string {
  if (!r.start) return r.name;
  const start = new Date(r.start);
  if (Number.isNaN(start.getTime())) return r.name;
  const p = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (r.duration) {
    const end = new Date(start.getTime() + r.duration * 1000);
    return `${fmt(start)} – ${fmt(end)}`;
  }
  return fmt(start);
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function PtzButton({
  label,
  title,
  onPress,
  subtle,
}: {
  label: string;
  title?: string;
  onPress: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      style={{ ...styles.ptzBtn, ...(subtle ? styles.ptzBtnSubtle : {}) }}
      onMouseDown={onPress}
      onMouseUp={ptzStop}
      onMouseLeave={ptzStop}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress();
      }}
      onTouchEnd={ptzStop}
    >
      {label}
    </button>
  );
}

const GLASS_BG = "rgba(15, 23, 42, 0.55)";
const GLASS_BORDER = "1px solid rgba(255,255,255,0.22)";

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: "14px", fontFamily: "var(--x-font-sans)", color: "var(--x-color-ink)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  eyebrow: { margin: 0, fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "var(--x-color-accent)" },
  title: { margin: "3px 0 0", fontSize: "20px", fontWeight: 800 },
  tabs: { display: "flex", gap: "6px", background: "var(--x-color-panel-alt)", padding: "4px", borderRadius: "999px" },
  tab: { border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontSize: "14px", fontWeight: 700, padding: "6px 18px", borderRadius: "999px", cursor: "pointer" },
  tabOn: { background: "var(--x-color-accent)", color: "#fff" },

  playerWrap: { position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", borderRadius: "var(--x-radius-md)", overflow: "hidden", boxShadow: "0 16px 40px var(--x-color-shadow)" },
  video: { width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" },
  overlayMsg: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", textAlign: "center", padding: "16px" },

  topBar: { position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", background: "linear-gradient(180deg, rgba(0,0,0,0.55), transparent)", transition: "opacity 0.3s" },
  topActions: { display: "flex", gap: 6 },
  badge: { fontSize: "12px", fontWeight: 700, padding: "4px 12px", borderRadius: "999px" },
  badgeLive: { background: "rgba(21,128,61,0.85)", color: "#fff" },
  badgeErr: { background: "rgba(180,35,24,0.9)", color: "#fff" },
  badgeLoad: { background: GLASS_BG, color: "#fff" },
  badgePlayback: { background: GLASS_BG, color: "#fff", border: GLASS_BORDER },

  glassBtn: { display: "inline-flex", alignItems: "center", gap: 4, border: GLASS_BORDER, background: GLASS_BG, color: "#fff", fontSize: "12.5px", fontWeight: 700, padding: "6px 12px", borderRadius: "999px", cursor: "pointer", textDecoration: "none", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" },
  glassBtnDisabled: { opacity: 0.4, cursor: "not-allowed" },

  ptzCluster: { position: "absolute", right: 12, bottom: 14, display: "flex", alignItems: "center", gap: 10, transition: "opacity 0.3s" },
  dpad: { display: "grid", gridTemplateColumns: "repeat(3, 46px)", gridTemplateRows: "repeat(3, 46px)", gap: 4, padding: 8, borderRadius: 18, background: GLASS_BG, border: GLASS_BORDER, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" },
  zoomStack: { display: "flex", flexDirection: "column", gap: 4, padding: 6, borderRadius: 14, background: GLASS_BG, border: GLASS_BORDER, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" },
  ptzBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 46, height: 46, borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: "17px", fontWeight: 700, cursor: "pointer", userSelect: "none", WebkitUserSelect: "none", touchAction: "none" },
  ptzBtnSubtle: { background: "transparent", border: "1px dashed rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.75)" },

  hintBar: { position: "absolute", left: 12, bottom: 14, padding: "6px 12px", borderRadius: 999, background: GLASS_BG, border: GLASS_BORDER, color: "rgba(255,255,255,0.85)", fontSize: 12, transition: "opacity 0.4s", pointerEvents: "none" },

  segNav: { position: "absolute", left: "50%", bottom: 56, transform: "translateX(-50%)", display: "flex", gap: 8, transition: "opacity 0.3s" },

  playbackWrap: { display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" },
  playbackMain: { flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" },
  recList: { flex: "0 1 300px", minWidth: 240, display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", maxHeight: 560 },
  recListHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  controlsTitle: { margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" },
  refreshBtn: { border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12px", fontWeight: 700, padding: "4px 12px", borderRadius: "8px", cursor: "pointer" },
  recError: { margin: 0, fontSize: "13px", color: "var(--x-color-danger)" },
  recEmpty: { margin: 0, fontSize: "13px", color: "var(--x-color-ink-muted)" },
  recScroll: { display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" },
  recDateHead: { position: "sticky", top: 0, padding: "4px 8px", fontSize: "11.5px", fontWeight: 800, letterSpacing: "0.05em", color: "var(--x-color-ink-muted)", background: "var(--x-color-panel)" },
  recItem: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", textAlign: "left", border: "1px solid transparent", background: "transparent", color: "var(--x-color-ink)", fontSize: "13px", padding: "8px 10px", borderRadius: "8px", cursor: "pointer" },
  recItemOn: { background: "var(--x-color-accent-soft)", border: "1px solid var(--x-color-accent)" },
  recTime: { fontWeight: 700, fontFamily: "var(--x-font-mono)", fontSize: "12.5px" },
  recMeta: { fontSize: "12px", color: "var(--x-color-ink-muted)", whiteSpace: "nowrap" },

  denied: { display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "48px 24px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)" },
  deniedTitle: { margin: 0, fontSize: "18px", fontWeight: 800, color: "var(--x-color-danger)" },
  deniedText: { margin: 0, fontSize: "14px", color: "var(--x-color-ink-muted)", maxWidth: 420 },
};
