import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import type { Socket } from "socket.io-client";

import { useBaseNavbarVisibility } from "../../../router/AppChromeContext";
import { uploadMirrorPhoto } from "./api";
import { MirrorAvatar } from "./MirrorAvatar";
import { connectMirrorSocket } from "./mirrorSocket";
import { SelfieCapture } from "./SelfieCapture";
import { FIRST_THOUGHT_HINTS, RATING_REMINDERS, SCORE_COLORS, SCORE_ITEMS, SKIP_VALUE } from "./types";
import type { MirrorPlayerSnapshot } from "./types";

const GUEST_ID_KEY = "xinya.mirror.guestId";
const GUEST_NAME_KEY = "xinya.mirror.guestName";

export function MirrorPlayerPage() {
  useBaseNavbarVisibility(false);

  const location = useLocation();
  const token = useMemo(
    () => new URLSearchParams(location.search).get("token")?.trim().toLowerCase() || "",
    [location.search],
  );

  const [guestId] = useState(getOrCreateGuestId);
  const [guestName, setGuestName] = useState(() => window.localStorage.getItem(GUEST_NAME_KEY) || "");
  const [step, setStep] = useState<"name" | "selfie">("name");
  const [photo, setPhoto] = useState("");
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MirrorPlayerSnapshot | null>(null);
  const [briefed, setBriefed] = useState(false);
  // Answers this phone has sent but whose snapshot has not come back yet, so
  // the next member shows up the instant you tap.
  const [pendingScores, setPendingScores] = useState<Record<string, string>>({});
  const socketRef = useRef<Socket | null>(null);
  const photoRef = useRef("");
  const photoSentRef = useRef(false);

  useEffect(() => {
    if (!token) setNotice("缺少活动 token");
  }, [token]);

  useEffect(() => {
    if (!joined || !token || !guestName.trim()) return;
    let socket: Socket | null = connectMirrorSocket();
    socketRef.current = socket;

    const join = () => {
      socket?.emit("mirror:guest:join", { room_token: token, guest_id: guestId, guest_name: guestName.trim() });
      setConnected(true);
    };
    const sync = () => socket?.emit("mirror:guest:sync", { room_token: token, guest_id: guestId });

    socket.on("connect", join);
    socket.on("disconnect", () => setConnected(false));
    socket.on("mirror:joined", () => void pushPhoto());
    socket.on("mirror:player", (snap: MirrorPlayerSnapshot) => {
      if (!snap?.room_token) return;
      setSnapshot(snap);
      setPendingScores({});
    });
    // Phase changes need the player's own view (targets / result), so pull it;
    // a progress tick only carries counters, so fold those in without a round trip.
    socket.on("mirror:state", sync);
    socket.on("mirror:progress", (p: Partial<MirrorPlayerSnapshot>) =>
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              member_count: p.member_count ?? prev.member_count,
              finished_count: p.finished_count ?? prev.finished_count,
              roster_count: p.roster_count ?? prev.roster_count,
            }
          : prev,
      ),
    );
    socket.on("mirror:rate_rejected", (p: { message?: string }) => setNotice(p?.message || "评分未被接受"));
    socket.on("mirror:error", (p: { message?: string }) => setNotice(p?.message || "连接失败"));
    if (socket.connected) join();

    return () => {
      socket?.disconnect();
      socket = null;
      socketRef.current = null;
      setConnected(false);
    };
  }, [joined, token, guestName, guestId]);

  const status = snapshot?.status || "lobby";
  const targets = snapshot?.targets || [];
  const scores = useMemo(
    () => ({ ...(snapshot?.my_scores || {}), ...pendingScores }),
    [snapshot?.my_scores, pendingScores],
  );
  const ratedCount = Object.keys(scores).length;
  const currentTarget = targets.find((target) => !(target.id in scores)) || null;
  const result = snapshot?.my_result || null;

  /** The room creates the member on join, so the photo goes up right after. */
  async function pushPhoto() {
    if (photoSentRef.current || !photoRef.current || !token) return;
    photoSentRef.current = true;
    try {
      await uploadMirrorPhoto(token, guestId, photoRef.current);
      socketRef.current?.emit("mirror:guest:sync", { room_token: token, guest_id: guestId });
    } catch (error) {
      photoSentRef.current = false;
      setNotice(error instanceof Error ? error.message : "照片上传失败，请重拍");
    }
  }

  function handleNameNext() {
    const name = guestName.trim();
    if (!name) {
      setNotice("请输入名字");
      return;
    }
    window.localStorage.setItem(GUEST_NAME_KEY, name);
    setNotice(null);
    setStep("selfie");
  }

  function handleJoin() {
    if (!photo) {
      setNotice("请先自拍一张正脸");
      return;
    }
    photoRef.current = photo;
    photoSentRef.current = false;
    setNotice(null);
    setJoined(true);
  }

  function handleRate(targetId: string, score: number | typeof SKIP_VALUE) {
    if (targetId in scores) return;
    setNotice(null);
    setPendingScores((prev) => ({ ...prev, [targetId]: String(score) }));
    if (navigator.vibrate) navigator.vibrate(30);
    socketRef.current?.emit("mirror:guest:rate", {
      room_token: token,
      guest_id: guestId,
      target_id: targetId,
      score,
    });
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        {!joined && step === "name" ? (
          <section style={cardStyle}>
            <div style={kickerStyle}>别人眼中的我</div>
            <div style={joinTitleStyle}>输入名字登记进入</div>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNameNext()}
              placeholder="你的名字"
              maxLength={24}
              style={joinInputStyle}
            />
            <button type="button" onClick={handleNameNext} style={primaryBtnStyle} disabled={!token}>
              下一步：自拍
            </button>
          </section>
        ) : null}

        {!joined && step === "selfie" ? (
          <section style={cardStyle}>
            <div style={kickerStyle}>{guestName}</div>
            <div style={joinTitleStyle}>自拍一张正脸</div>
            <div style={{ ...mutedStyle, textAlign: "center" }}>
              评分时大家会看到这张照片，好认出今天和谁有过互动。
            </div>
            <SelfieCapture photo={photo} onCaptured={setPhoto} />
            <button type="button" onClick={handleJoin} style={primaryBtnStyle} disabled={!photo}>
              {photo ? "进入活动" : "请先拍一张"}
            </button>
            <button type="button" onClick={() => setStep("name")} style={backLinkStyle}>
              改名字
            </button>
          </section>
        ) : null}

        {joined && status === "lobby" ? (
          <section style={centerCardStyle}>
            {snapshot?.me ? (
              <MirrorAvatar
                token={token}
                memberId={snapshot.me.id}
                name={snapshot.me.name}
                photoAtMs={snapshot.me.photo_at_ms}
                size={96}
              />
            ) : null}
            <div style={bigTitleStyle}>{guestName}，你已登记</div>
            <div style={mutedStyle}>等待主持人点击「开始」…</div>
            <div style={mutedStyle}>目前 {snapshot?.member_count ?? 0} 位成员在场</div>
            <div style={connRowStyle}>
              <span style={connDotStyle(connected)} /> {connected ? "已连接" : "连接中…"}
            </div>
          </section>
        ) : null}

        {joined && status === "rating" && !snapshot?.in_roster ? (
          <section style={centerCardStyle}>
            <div style={{ fontSize: "52px" }}>⏳</div>
            <div style={bigTitleStyle}>这一轮已经开始了</div>
            <div style={mutedStyle}>你不在本轮名单里，请告诉主持人。</div>
          </section>
        ) : null}

        {joined && status === "rating" && snapshot?.in_roster && !briefed && !snapshot.finished ? (
          <section style={cardStyle}>
            <div style={kickerStyle}>开始之前</div>
            <div style={joinTitleStyle}>请根据今天真实发生过的互动评分</div>
            <div style={mutedStyle}>
              评价对方的言语、语气和态度，是否让你感受到礼貌与尊重。
            </div>
            <ul style={reminderListStyle}>
              {RATING_REMINDERS.map((line) => (
                <li key={line} style={reminderItemStyle}>
                  {line}
                </li>
              ))}
            </ul>
            <div style={scaleWrapStyle}>
              {SCORE_ITEMS.map((item) => (
                <div key={item.score} style={scaleRowStyle}>
                  <span style={{ ...scaleBadgeStyle, background: item.color }}>{item.score}</span>
                  <span style={scaleDescStyle}>{item.desc}</span>
                </div>
              ))}
              <div style={scaleRowStyle}>
                <span style={{ ...scaleBadgeStyle, background: "var(--x-color-ink-muted)" }}>?</span>
                <span style={scaleDescStyle}>无法判断：今天没有足够互动，不计入结果</span>
              </div>
            </div>
            <button type="button" onClick={() => setBriefed(true)} style={primaryBtnStyle}>
              我明白了，开始评分
            </button>
          </section>
        ) : null}

        {joined && status === "rating" && snapshot?.in_roster && briefed && currentTarget ? (
          <section style={ratingWrapStyle}>
            <div style={progressRowStyle}>
              <span style={progressLabelStyle}>
                {ratedCount + 1} / {targets.length}
              </span>
              <div style={progressTrackStyle}>
                <div style={{ ...progressBarStyle, width: `${(ratedCount / targets.length) * 100}%` }} />
              </div>
            </div>

            <div style={targetCardStyle}>
              <div style={mutedStyle}>今天和这位成员的互动中</div>
              <MirrorAvatar
                token={token}
                memberId={currentTarget.id}
                name={currentTarget.name}
                photoAtMs={currentTarget.photo_at_ms}
                size={140}
              />
              <div style={targetNameStyle}>{currentTarget.name}</div>
              <div style={targetQuestionStyle}>他的言语、语气和态度，让你感受到礼貌与尊重吗？</div>
            </div>

            <div style={scoreGridStyle}>
              {SCORE_ITEMS.map((item) => (
                <button
                  key={item.score}
                  type="button"
                  onClick={() => handleRate(currentTarget.id, item.score)}
                  style={scoreBtnStyle(item.color)}
                >
                  <span style={scoreNumStyle}>{item.score}</span>
                  <span style={scoreDescStyle}>{item.desc}</span>
                </button>
              ))}
              <button type="button" onClick={() => handleRate(currentTarget.id, SKIP_VALUE)} style={skipBtnStyle}>
                无法判断（今天没有足够互动）
              </button>
            </div>

            <div style={anonHintStyle}>🔒 全程匿名 · 请根据真实感受评分 · 结束后不讨论谁给了多少分</div>
          </section>
        ) : null}

        {joined && status === "rating" && snapshot?.in_roster && briefed && !currentTarget ? (
          <section style={centerCardStyle}>
            <div style={{ fontSize: "52px" }}>✅</div>
            <div style={bigTitleStyle}>你已完成</div>
            <div style={mutedStyle}>
              等待其他成员…（{snapshot.finished_count}/{snapshot.roster_count}）
            </div>
            <div style={mutedStyle}>全部完成后就会看到自己的成绩。</div>
          </section>
        ) : null}

        {joined && status === "reveal" ? (
          <section style={centerCardStyle}>
            {result ? (
              <>
                <div style={kickerStyle}>你的成绩（只有你看得到）</div>
                {result.visible ? (
                  <>
                    <div style={averageStyle}>{result.average}</div>
                    <div style={mutedStyle}>
                      来自 {result.rated_count} 位成员的平均分
                      {result.skipped_count ? ` · ${result.skipped_count} 位选择「无法判断」` : ""}
                    </div>
                    {result.counts ? <PlayerDistribution counts={result.counts} /> : null}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: "52px" }}>🫥</div>
                    <div style={bigTitleStyle}>这次不显示分数</div>
                    <div style={mutedStyle}>
                      只收到 {result.rated_count} 份有效评分（少于 {result.min_reveal_count} 份），
                      为了保护匿名不显示平均分。
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: "52px" }}>🫥</div>
                <div style={bigTitleStyle}>你没有参与这一轮</div>
                <div style={mutedStyle}>所以这次没有成绩。</div>
              </>
            )}

            <div style={promptCardStyle}>
              <div style={promptTitleStyle}>你看到成绩后的第一个念头是什么？</div>
              <div style={hintWrapStyle}>
                {FIRST_THOUGHT_HINTS.map((hint) => (
                  <span key={hint} style={hintChipStyle}>
                    {hint}
                  </span>
                ))}
              </div>
              <div style={mutedStyle}>先不要讨论。安静 1–2 分钟，看看自己心里出现了什么反应。</div>
            </div>

            <div style={closingStyle}>
              别人感受到的你，可能和你想象中的自己不一样。这里不是比较谁分数高低，
              而是看见自己面对评价时的第一反应。
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function PlayerDistribution({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div style={distWrapStyle}>
      {SCORE_ITEMS.map((item, i) => (
        <div key={item.score} style={distRowStyle}>
          <span style={distLabelStyle}>{item.score} 分</span>
          <div style={distTrackStyle}>
            <div
              style={{ ...distBarStyle, width: `${((counts[i] || 0) / max) * 100}%`, background: SCORE_COLORS[i] }}
            />
          </div>
          <span style={distCountStyle}>{counts[i] || 0}</span>
        </div>
      ))}
    </div>
  );
}

function getOrCreateGuestId() {
  const existing = window.localStorage.getItem(GUEST_ID_KEY);
  if (existing) return existing;
  const next = `m_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(GUEST_ID_KEY, next);
  return next;
}

/* ═══════════════════ styles ═══════════════════ */

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--x-color-canvas)", color: "var(--x-color-ink)" };
const shellStyle: CSSProperties = {
  width: "min(560px, calc(100% - 24px))",
  margin: "0 auto",
  padding: "18px 0 40px",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};
const noticeStyle: CSSProperties = {
  marginBottom: "12px",
  padding: "10px 14px",
  borderRadius: "8px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
  textAlign: "center",
};
const cardStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "24px 20px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "14px",
  background: "var(--x-color-panel)",
  boxShadow: "0 8px 24px var(--x-color-shadow-soft)",
};
const centerCardStyle: CSSProperties = { display: "grid", gap: "12px", justifyItems: "center", textAlign: "center" };
const kickerStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
  letterSpacing: "0.14em",
};
const joinTitleStyle: CSSProperties = { textAlign: "center", fontSize: "20px", fontWeight: 900, lineHeight: 1.5 };
const joinInputStyle: CSSProperties = {
  minHeight: "54px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "10px",
  padding: "0 16px",
  fontSize: "18px",
  textAlign: "center",
};
const primaryBtnStyle: CSSProperties = {
  minHeight: "54px",
  border: "none",
  borderRadius: "10px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "18px",
  fontWeight: 900,
  cursor: "pointer",
};
const bigTitleStyle: CSSProperties = { fontSize: "26px", fontWeight: 900 };
const mutedStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 700, lineHeight: 1.6 };
const connRowStyle: CSSProperties = {
  marginTop: "8px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};
const connDotStyle = (on: boolean): CSSProperties => ({
  width: "10px",
  height: "10px",
  borderRadius: "999px",
  background: on ? "var(--x-color-success)" : "var(--x-color-danger)",
});
const backLinkStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
  cursor: "pointer",
  minHeight: "38px",
};
const reminderListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "20px",
  display: "grid",
  gap: "6px",
  fontWeight: 700,
  lineHeight: 1.6,
};
const reminderItemStyle: CSSProperties = { color: "var(--x-color-ink)" };
const scaleWrapStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "12px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
};
const scaleRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px" };
const scaleBadgeStyle: CSSProperties = {
  minWidth: "26px",
  height: "26px",
  borderRadius: "999px",
  color: "white",
  fontWeight: 900,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "14px",
};
const scaleDescStyle: CSSProperties = { fontSize: "14px", fontWeight: 700, lineHeight: 1.4 };

const ratingWrapStyle: CSSProperties = { display: "grid", gap: "14px" };
const progressRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px" };
const progressLabelStyle: CSSProperties = {
  fontWeight: 900,
  background: "var(--x-color-panel-alt)",
  padding: "5px 12px",
  borderRadius: "999px",
  whiteSpace: "nowrap",
};
const progressTrackStyle: CSSProperties = {
  flex: 1,
  height: "12px",
  background: "var(--x-color-panel-alt)",
  borderRadius: "999px",
  overflow: "hidden",
};
const progressBarStyle: CSSProperties = { height: "100%", background: "var(--x-color-accent)", transition: "width 0.3s ease" };
const targetCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  justifyItems: "center",
  textAlign: "center",
  padding: "20px 16px",
  borderRadius: "16px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
};
const targetNameStyle: CSSProperties = { fontSize: "clamp(26px,7vw,34px)", fontWeight: 900, overflowWrap: "anywhere" };
const targetQuestionStyle: CSSProperties = { fontSize: "15px", fontWeight: 700, lineHeight: 1.5 };
const scoreGridStyle: CSSProperties = { display: "grid", gap: "10px" };
const scoreBtnStyle = (color: string): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  minHeight: "60px",
  padding: "10px 16px",
  border: "none",
  borderRadius: "14px",
  background: color,
  color: "white",
  textAlign: "left",
  cursor: "pointer",
  boxShadow: "0 4px 0 rgba(0,0,0,0.22)",
});
const scoreNumStyle: CSSProperties = { fontSize: "26px", fontWeight: 900, minWidth: "26px" };
const scoreDescStyle: CSSProperties = { fontSize: "14px", fontWeight: 700, lineHeight: 1.35 };
const skipBtnStyle: CSSProperties = {
  minHeight: "54px",
  border: "2px dashed var(--x-color-line)",
  borderRadius: "14px",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
  fontSize: "15px",
  cursor: "pointer",
};
const anonHintStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
  fontSize: "13px",
  lineHeight: 1.6,
};

const averageStyle: CSSProperties = {
  fontSize: "64px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  fontFamily: "var(--x-font-mono)",
  lineHeight: 1,
};
const promptCardStyle: CSSProperties = {
  width: "100%",
  display: "grid",
  gap: "10px",
  justifyItems: "center",
  padding: "18px 16px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
};
const promptTitleStyle: CSSProperties = { fontSize: "18px", fontWeight: 900, textAlign: "center" };
const hintWrapStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" };
const hintChipStyle: CSSProperties = {
  background: "var(--x-color-panel-alt)",
  padding: "6px 14px",
  borderRadius: "999px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  fontSize: "14px",
};
const closingStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
  fontSize: "14px",
  lineHeight: 1.7,
  textAlign: "center",
};
const distWrapStyle: CSSProperties = { width: "100%", display: "grid", gap: "6px", marginTop: "6px" };
const distRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px" };
const distLabelStyle: CSSProperties = { minWidth: "44px", fontWeight: 800, fontSize: "14px", textAlign: "right" };
const distTrackStyle: CSSProperties = {
  flex: 1,
  height: "14px",
  background: "var(--x-color-panel-alt)",
  borderRadius: "999px",
  overflow: "hidden",
};
const distBarStyle: CSSProperties = { height: "100%", borderRadius: "999px", transition: "width 0.3s ease" };
const distCountStyle: CSSProperties = {
  minWidth: "28px",
  fontFamily: "var(--x-font-mono)",
  fontWeight: 800,
  fontSize: "14px",
};
