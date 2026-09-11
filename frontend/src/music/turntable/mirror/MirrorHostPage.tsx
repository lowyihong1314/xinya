import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import type { Socket } from "socket.io-client";

import { useUserState } from "../../../app/UserState";
import { createMirrorSession, getMirrorSession, saveMirrorConfig } from "./api";
import { MirrorAvatar } from "./MirrorAvatar";
import { buildMirrorPlayerUrl, connectMirrorSocket } from "./mirrorSocket";
import { FIRST_THOUGHT_HINTS, RATING_REMINDERS } from "./types";
import type { MirrorHostSnapshot } from "./types";

const HOST_TOKEN_STORAGE_KEY = "xinya.mirror.hostToken";

export function MirrorHostPage({ onBack }: { onBack: () => void }) {
  const { isAuthenticated } = useUserState();
  const [snapshot, setSnapshot] = useState<MirrorHostSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [minReveal, setMinReveal] = useState(3);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const socketRef = useRef<Socket | null>(null);

  const token = snapshot?.room_token || "";
  const guestUrl = useMemo(() => (token ? buildMirrorPlayerUrl(token) : ""), [token]);
  const status = snapshot?.status || "lobby";
  const members = snapshot?.members || [];
  const roster = snapshot?.roster || [];
  const finishedCount = snapshot?.finished_count || 0;
  const rosterCount = snapshot?.roster_count || 0;
  // 每人最多只能收到「在场人数 - 1」份评分；阈值比这还高，公布时就没有人看得到分数。
  const peerCeiling = Math.max(0, (status === "lobby" ? members.length : rosterCount) - 1);
  const thresholdTooHigh = peerCeiling > 0 && peerCeiling < (snapshot?.min_reveal_count || minReveal);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    let active = true;
    async function loadSession() {
      setLoading(true);
      setNotice(null);
      try {
        const storedToken = window.localStorage.getItem(HOST_TOKEN_STORAGE_KEY);
        let nextToken = "";
        if (storedToken) {
          try {
            nextToken = (await getMirrorSession(storedToken)).room_token;
          } catch {
            window.localStorage.removeItem(HOST_TOKEN_STORAGE_KEY);
          }
        }
        if (!nextToken) nextToken = (await createMirrorSession()).token;
        if (!active) return;
        window.localStorage.setItem(HOST_TOKEN_STORAGE_KEY, nextToken);
        // The socket join fills in the full snapshot right after this.
        setSnapshot((prev) => prev || ({ room_token: nextToken, status: "lobby" } as MirrorHostSnapshot));
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "创建活动失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!token) return;
    let socket: Socket | null = connectMirrorSocket();
    socketRef.current = socket;

    const join = () => socket?.emit("mirror:host:join", { room_token: token });
    const sync = () => socket?.emit("mirror:host:sync", { room_token: token });
    const applyHost = (snap: MirrorHostSnapshot) => {
      if (!snap?.room_token) return;
      setSnapshot(snap);
      setMinReveal(snap.min_reveal_count || 3);
    };

    socket.on("connect", join);
    socket.on("mirror:host", applyHost);
    // Phase changes and每一次评分 both just nudge the host to re-pull its own view.
    socket.on("mirror:state", sync);
    socket.on("mirror:progress", sync);
    socket.on("mirror:error", (p: { message?: string }) => setNotice(p?.message || "连接错误"));
    if (socket.connected) join();

    return () => {
      socket?.disconnect();
      socket = null;
      socketRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (!guestUrl) return;
    let active = true;
    void QRCode.toDataURL(guestUrl, { width: 320, margin: 1, color: { dark: "#111827", light: "#ffffff" } }).then(
      (url: string) => {
        if (active) setQrDataUrl(url);
      },
    );
    return () => {
      active = false;
    };
  }, [guestUrl]);

  async function handleMinRevealBlur() {
    if (!token) return;
    try {
      const next = await saveMirrorConfig(token, { min_reveal_count: minReveal });
      setSnapshot(next);
      setMinReveal(next.min_reveal_count);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存设置失败");
    }
  }

  async function lowerThreshold(next: number) {
    if (!token || next < 1) return;
    try {
      const updated = await saveMirrorConfig(token, { min_reveal_count: next });
      setSnapshot(updated);
      setMinReveal(updated.min_reveal_count);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存设置失败");
    }
  }

  function emit(event: string, payload: Record<string, unknown> = {}) {
    socketRef.current?.emit(event, { room_token: token, ...payload });
  }

  function handleReset() {
    if (!window.confirm("重新开始会清空这一轮所有评分，确定吗？")) return;
    emit("mirror:host:reset");
  }

  if (!isAuthenticated) {
    return (
      <main style={pageStyle}>
        <div style={shellStyle}>
          <TopBar onBack={onBack} />
          <div style={infoCardStyle}>请先登录（组织者）才能主持这个活动。</div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={shellStyle}>
          <TopBar onBack={onBack} />
          <div style={infoCardStyle}>准备活动房间中…</div>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <button type="button" onClick={onBack} style={exitFabStyle} title="退出主持">
        <i className="fas fa-xmark" aria-hidden="true" /> 退出
      </button>

      <div style={shellStyle}>
        {notice ? <div style={errorStyle}>{notice}</div> : null}

        {status === "lobby" ? (
          <section style={centerStyle}>
            <span style={kickerStyle}>别人眼中的我</span>
            <h1 style={bigTitleStyle}>请大家先登记进入</h1>
            {qrDataUrl ? (
              <div style={qrCardStyle}>
                <img src={qrDataUrl} alt="扫码登记" style={{ width: "min(240px,50vw)", display: "block" }} />
              </div>
            ) : null}
            <div style={joinHintStyle}>
              📱 扫码登记 · 房间号 <b style={{ color: "var(--x-color-accent)" }}>{token}</b>
            </div>
            <div style={countStyle}>{members.length}</div>
            <div style={mutedStyle}>位成员已进入</div>
            <div style={chipsStyle}>
              {members.map((m) => (
                <span key={m.id} style={{ ...chipStyle, opacity: m.online ? 1 : 0.45 }}>
                  <MirrorAvatar token={token} memberId={m.id} name={m.name} photoAtMs={m.photo_at_ms} size={34} />
                  {m.name}
                  <button
                    type="button"
                    onClick={() => emit("mirror:host:kick", { guest_id: m.id })}
                    style={chipKickStyle}
                    title="移除"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <label style={settingRowStyle}>
              <span>最少收到</span>
              <input
                type="number"
                min={1}
                max={20}
                value={minReveal}
                onChange={(e) => setMinReveal(Number(e.target.value) || 1)}
                onBlur={() => void handleMinRevealBlur()}
                style={settingInputStyle}
              />
              <span>份有效评分才显示分数（保护匿名）</span>
            </label>

            {thresholdTooHigh ? (
              <div style={warnStyle}>
                ⚠️ 现在 {members.length} 位成员，每人最多收到 {peerCeiling} 份评分，低于上面的 {snapshot?.min_reveal_count || minReveal} 份
                ——这样公布时所有人都看不到分数。请调到 {peerCeiling} 或更低，或等更多人进来。
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => emit("mirror:host:start")}
              disabled={members.length < 2}
              style={bigActionBtnStyle}
            >
              <i className="fas fa-play" aria-hidden="true" /> 开始
            </button>
            {members.length < 2 ? <div style={mutedStyle}>至少 2 位成员才能开始</div> : null}
          </section>
        ) : null}

        {status === "rating" ? (
          <section style={centerStyle}>
            <span style={kickerStyle}>评分进行中</span>
            <h1 style={bigTitleStyle}>
              {finishedCount} / {rosterCount}
            </h1>
            <div style={mutedStyle}>位成员已完成评分</div>
            <div style={progressTrackStyle}>
              <div style={{ ...progressBarStyle, width: `${rosterCount ? (finishedCount / rosterCount) * 100 : 0}%` }} />
            </div>
            <div style={chipsStyle}>
              {roster.map((row) => (
                <span key={row.id} style={{ ...chipStyle, ...(row.finished ? doneChipStyle : {}) }}>
                  <MirrorAvatar token={token} memberId={row.id} name={row.name} photoAtMs={row.photo_at_ms} size={34} />
                  {row.finished ? "✅" : "⏳"} {row.name}
                </span>
              ))}
            </div>
            <div style={reminderCardStyle}>
              {RATING_REMINDERS.map((line) => (
                <div key={line} style={reminderLineStyle}>
                  · {line}
                </div>
              ))}
            </div>
            {thresholdTooHigh ? (
              <div style={warnStyle}>
                ⚠️ 本轮 {rosterCount} 人，每人最多收到 {peerCeiling} 份评分，低于阈值 {snapshot?.min_reveal_count || minReveal} 份，
                现在公布的话所有人都看不到分数。
                <button type="button" onClick={() => void lowerThreshold(peerCeiling)} style={inlineFixBtnStyle}>
                  调成 {peerCeiling} 份
                </button>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" onClick={() => emit("mirror:host:reveal")} style={ghostActionBtnStyle}>
                <i className="fas fa-unlock" aria-hidden="true" /> 提前公布成绩
              </button>
              <button type="button" onClick={handleReset} style={ghostActionBtnStyle}>
                <i className="fas fa-rotate-left" aria-hidden="true" /> 重新开始
              </button>
            </div>
            <div style={mutedStyle}>全部人完成后会自动公布</div>
          </section>
        ) : null}

        {status === "reveal" ? (
          <section style={centerStyle}>
            <span style={kickerStyle}>成绩已公布</span>
            <h1 style={bigTitleStyle}>请看自己的手机</h1>
            <div style={mutedStyle}>每个人只看得到自己的成绩</div>

            <div style={promptCardStyle}>
              <div style={promptTitleStyle}>你看到成绩后的第一个念头是什么？</div>
              <div style={hintWrapStyle}>
                {FIRST_THOUGHT_HINTS.map((hint) => (
                  <span key={hint} style={hintChipStyle}>
                    {hint}
                  </span>
                ))}
              </div>
              <div style={mutedStyle}>先不要讨论，安静 1–2 分钟，观察自己的第一反应。</div>
            </div>

            <button type="button" onClick={handleReset} style={ghostActionBtnStyle}>
              <i className="fas fa-rotate-left" aria-hidden="true" /> 重新开始
            </button>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <header style={topBarStyle}>
      <button type="button" onClick={onBack} style={ghostBtnStyle}>
        <i className="fas fa-arrow-left" aria-hidden="true" /> 返回
      </button>
      <div style={{ textAlign: "center" }}>
        <span style={kickerStyle}>别人眼中的我</span>
      </div>
      <div style={{ width: "88px" }} />
    </header>
  );
}

/* ═══════════════════ styles ═══════════════════ */

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
  padding: "20px",
  boxSizing: "border-box",
};
const shellStyle: CSSProperties = { width: "min(860px, 100%)", margin: "0 auto", padding: "8px 0 40px" };
const topBarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "12px",
  minHeight: "54px",
};
const exitFabStyle: CSSProperties = {
  position: "fixed",
  top: "12px",
  right: "16px",
  zIndex: 9,
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "8px 16px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "999px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const ghostBtnStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const centerStyle: CSSProperties = {
  minHeight: "calc(100vh - 80px)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  textAlign: "center",
};
const kickerStyle: CSSProperties = {
  display: "block",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
  letterSpacing: "0.14em",
};
const bigTitleStyle: CSSProperties = { fontSize: "clamp(26px,4vw,42px)", margin: 0 };
const mutedStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 700 };
const qrCardStyle: CSSProperties = {
  background: "white",
  borderRadius: "18px",
  padding: "14px",
  boxShadow: "0 10px 30px var(--x-color-shadow-soft)",
};
const joinHintStyle: CSSProperties = { fontSize: "18px", fontWeight: 700 };
const countStyle: CSSProperties = {
  fontSize: "clamp(38px,6vw,64px)",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  lineHeight: 1,
};
const chipsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  justifyContent: "center",
  maxWidth: "820px",
  maxHeight: "28vh",
  overflow: "auto",
};
const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  background: "var(--x-color-panel-alt)",
  padding: "6px 16px 6px 6px",
  borderRadius: "999px",
  fontWeight: 700,
};
const doneChipStyle: CSSProperties = { background: "var(--x-color-accent-soft)" };
const chipKickStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  fontWeight: 900,
  padding: 0,
};
const settingRowStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
  flexWrap: "wrap",
  justifyContent: "center",
};
const settingInputStyle: CSSProperties = {
  width: "72px",
  minHeight: "40px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  textAlign: "center",
  fontSize: "16px",
  fontWeight: 800,
};
const bigActionBtnStyle: CSSProperties = {
  minHeight: "58px",
  padding: "0 44px",
  border: "none",
  borderRadius: "14px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "22px",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 10px 26px var(--x-color-shadow-soft)",
};
const ghostActionBtnStyle: CSSProperties = {
  minHeight: "48px",
  padding: "0 22px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "10px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  fontSize: "16px",
  cursor: "pointer",
};
const errorStyle: CSSProperties = {
  margin: "12px 0",
  padding: "12px 14px",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
};
const infoCardStyle: CSSProperties = {
  marginTop: "24px",
  padding: "40px 20px",
  textAlign: "center",
  borderRadius: "12px",
  border: "1px dashed var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};
const warnStyle: CSSProperties = {
  width: "min(560px, 100%)",
  padding: "12px 16px",
  borderRadius: "12px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  lineHeight: 1.6,
  textAlign: "left",
};
const inlineFixBtnStyle: CSSProperties = {
  marginLeft: "8px",
  minHeight: "34px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "999px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const progressTrackStyle: CSSProperties = {
  width: "min(520px, 100%)",
  height: "14px",
  background: "var(--x-color-panel-alt)",
  borderRadius: "999px",
  overflow: "hidden",
};
const progressBarStyle: CSSProperties = {
  height: "100%",
  background: "var(--x-color-accent)",
  transition: "width 0.3s ease",
};
const reminderCardStyle: CSSProperties = {
  width: "min(560px, 100%)",
  display: "grid",
  gap: "6px",
  padding: "16px 20px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  textAlign: "left",
};
const reminderLineStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.6 };
const promptCardStyle: CSSProperties = {
  width: "min(620px, 100%)",
  display: "grid",
  gap: "12px",
  justifyItems: "center",
  padding: "22px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxShadow: "0 8px 24px var(--x-color-shadow-soft)",
};
const promptTitleStyle: CSSProperties = { fontSize: "clamp(20px,3vw,28px)", fontWeight: 900 };
const hintWrapStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" };
const hintChipStyle: CSSProperties = {
  background: "var(--x-color-panel-alt)",
  padding: "6px 14px",
  borderRadius: "999px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};
