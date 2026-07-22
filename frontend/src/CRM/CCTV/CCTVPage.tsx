import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { apiFetch } from "../../js/apiFetch";
import { API_BASE } from "../../js/apiBase";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";
import { hasUserPermission } from "../../app/permissions";
import "./vendor/videoRtcElement";

// go2rtc low-latency stream (MSE over WebSocket, ~1s). Same-origin behind nginx auth.
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
  size: number;
  url: string;
};

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
          <button
            type="button"
            style={{ ...styles.tab, ...(mode === "live" ? styles.tabOn : {}) }}
            onClick={() => setMode("live")}
          >
            直播
          </button>
          <button
            type="button"
            style={{ ...styles.tab, ...(mode === "playback" ? styles.tabOn : {}) }}
            onClick={() => setMode("playback")}
          >
            回放
          </button>
        </div>
      </header>

      {mode === "live" ? <LiveView /> : <PlaybackView />}
    </section>
  );
}

function LiveView() {
  const elRef = useRef<VideoRtcEl | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.background = false;
    el.mode = "mse"; // 强制 MSE：走 443 WebSocket，无需 UDP/ICE
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
  }, []);

  return (
    <>
      <div style={styles.playerWrap}>
        <video-rtc-cctv ref={elRef} style={styles.video} />
        <span
          style={{
            ...styles.badge,
            ...(status === "live" ? styles.badgeLive : status === "error" ? styles.badgeErr : styles.badgeLoad),
          }}
        >
          {status === "live" ? "● 直播中" : status === "error" ? "连接失败" : "连接中…"}
        </span>
        {status === "error" ? (
          <div style={styles.overlayMsg}>无法连接直播流，请稍后重试或检查转流服务。</div>
        ) : null}
      </div>

      <div style={styles.controls}>
        <p style={styles.controlsTitle}>云台控制（按住移动）</p>
        <div style={styles.padRow}>
          <div style={styles.dpad}>
            <div />
            <PtzButton label="▲" onPress={() => ptzMove(0, 0.4)} />
            <div />
            <PtzButton label="◀" onPress={() => ptzMove(-0.4, 0)} />
            <PtzButton label="■" onPress={ptzStop} />
            <PtzButton label="▶" onPress={() => ptzMove(0.4, 0)} />
            <div />
            <PtzButton label="▼" onPress={() => ptzMove(0, -0.4)} />
            <div />
          </div>
          <div style={styles.zoomCol}>
            <PtzButton label="放大 +" onPress={() => ptzMove(0, 0, 0.4)} wide />
            <PtzButton label="缩小 −" onPress={() => ptzMove(0, 0, -0.4)} wide />
          </div>
        </div>
      </div>
    </>
  );
}

function PlaybackView() {
  const [items, setItems] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Recording | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/move_camera/recordings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "加载失败");
      const list: Recording[] = data.items || [];
      setItems(list);
      setCurrent((prev) => prev ?? list[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={styles.playbackWrap}>
      <div style={styles.playbackMain}>
        <div style={styles.playerWrap}>
          {current ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video key={current.name} src={current.url} style={styles.video} controls autoPlay playsInline />
          ) : (
            <div style={styles.overlayMsg}>{loading ? "加载录像…" : "暂无录像"}</div>
          )}
        </div>
        {current ? <p style={styles.nowPlaying}>正在回放：{fmtLabel(current)}</p> : null}
      </div>

      <aside style={styles.recList}>
        <div style={styles.recListHead}>
          <span style={styles.controlsTitle}>录像片段</span>
          <button type="button" style={styles.refreshBtn} onClick={() => void load()}>
            刷新
          </button>
        </div>
        {error ? <p style={styles.recError}>{error}</p> : null}
        {!error && !loading && items.length === 0 ? <p style={styles.recEmpty}>暂无已保存的录像</p> : null}
        <div style={styles.recScroll}>
          {items.map((r) => (
            <button
              type="button"
              key={r.name}
              style={{ ...styles.recItem, ...(current?.name === r.name ? styles.recItemOn : {}) }}
              onClick={() => setCurrent(r)}
            >
              <span style={styles.recTime}>{fmtLabel(r)}</span>
              <span style={styles.recSize}>{fmtSize(r.size)}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function fmtLabel(r: Recording): string {
  if (!r.start) return r.name;
  const d = new Date(r.start);
  if (Number.isNaN(d.getTime())) return r.name;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function PtzButton({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      style={{ ...styles.ptzBtn, ...(wide ? styles.ptzWide : {}) }}
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

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: "14px", fontFamily: "var(--x-font-sans)", color: "var(--x-color-ink)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" },
  eyebrow: { margin: 0, fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "var(--x-color-accent)" },
  title: { margin: "3px 0 0", fontSize: "20px", fontWeight: 800 },
  tabs: { display: "flex", gap: "6px", background: "var(--x-color-panel-alt)", padding: "4px", borderRadius: "999px" },
  tab: { border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontSize: "14px", fontWeight: 700, padding: "6px 18px", borderRadius: "999px", cursor: "pointer" },
  tabOn: { background: "var(--x-color-accent)", color: "#fff" },
  badge: { position: "absolute", top: "10px", left: "10px", fontSize: "12px", fontWeight: 700, padding: "4px 12px", borderRadius: "999px" },
  badgeLive: { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" },
  badgeErr: { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" },
  badgeLoad: { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" },
  playerWrap: { position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", borderRadius: "var(--x-radius-md)", overflow: "hidden", boxShadow: "0 16px 40px var(--x-color-shadow)" },
  video: { width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" },
  overlayMsg: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "14px", textAlign: "center", padding: "16px" },
  controls: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", maxWidth: 960 },
  controlsTitle: { margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" },
  padRow: { display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" },
  dpad: { display: "grid", gridTemplateColumns: "repeat(3, 52px)", gridTemplateRows: "repeat(3, 52px)", gap: "6px" },
  zoomCol: { display: "flex", flexDirection: "column", gap: "6px" },
  ptzBtn: { display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "10px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "18px", fontWeight: 700, cursor: "pointer", userSelect: "none", WebkitUserSelect: "none" },
  ptzWide: { padding: "12px 18px", fontSize: "14px", whiteSpace: "nowrap" },
  playbackWrap: { display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" },
  playbackMain: { flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" },
  nowPlaying: { margin: 0, fontSize: "13px", color: "var(--x-color-ink-muted)", fontWeight: 600 },
  recList: { flex: "0 1 300px", minWidth: 240, display: "flex", flexDirection: "column", gap: "10px", padding: "14px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", maxHeight: 520 },
  recListHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  refreshBtn: { border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12px", fontWeight: 700, padding: "4px 12px", borderRadius: "8px", cursor: "pointer" },
  recError: { margin: 0, fontSize: "13px", color: "var(--x-color-danger)" },
  recEmpty: { margin: 0, fontSize: "13px", color: "var(--x-color-ink-muted)" },
  recScroll: { display: "flex", flexDirection: "column", gap: "4px", overflowY: "auto" },
  recItem: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", textAlign: "left", border: "1px solid transparent", background: "transparent", color: "var(--x-color-ink)", fontSize: "13px", padding: "8px 10px", borderRadius: "8px", cursor: "pointer" },
  recItemOn: { background: "var(--x-color-accent-soft)", border: "1px solid var(--x-color-accent)" },
  recTime: { fontWeight: 600 },
  recSize: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  denied: { display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "48px 24px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)" },
  deniedTitle: { margin: 0, fontSize: "18px", fontWeight: 800, color: "var(--x-color-danger)" },
  deniedText: { margin: 0, fontSize: "14px", color: "var(--x-color-ink-muted)", maxWidth: 420 },
};
