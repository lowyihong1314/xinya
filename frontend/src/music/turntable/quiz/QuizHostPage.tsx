import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import QRCode from "qrcode";
import type { Socket } from "socket.io-client";

import { useUserState } from "../../../app/UserState";
import {
  closeQuizSession,
  createQuizSession,
  getQuizSession,
  publishQuizSession,
  resetQuizSession,
  saveQuizConfig,
} from "./api";
import { connectQuizSocket } from "./quizSocket";
import type { QuizAnswer, QuizConfig, QuizSessionSnapshot } from "./types";

const HOST_TOKEN_STORAGE_KEY = "xinya.quiz.hostToken";
const MAX_ANSWERS = 9;

type Notice = {
  tone: "success" | "error" | "info";
  text: string;
};

export function QuizHostPage({ onBack }: { onBack: () => void }) {
  const { isAuthenticated } = useUserState();
  const [snapshot, setSnapshot] = useState<QuizSessionSnapshot | null>(null);
  const [draft, setDraft] = useState<QuizConfig>(() => createDraftConfig());
  const [view, setView] = useState<"home" | "settings">("home");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [qrDataUrl, setQrDataUrl] = useState("");

  const token = snapshot?.room_token || "";
  const guestUrl = useMemo(() => (token ? buildGuestUrl(token) : ""), [token]);
  const derivedStatus = snapshot ? deriveStatus(snapshot, Date.now() + serverOffsetMs) : "draft";
  const remainingMs = snapshot?.config.start_at_ms ? Math.max(0, snapshot.config.start_at_ms - (tick + serverOffsetMs)) : 0;

  useEffect(() => {
    if (!isAuthenticated && view === "settings") {
      setView("home");
    }
  }, [isAuthenticated, view]);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      setLoading(true);
      setNotice(null);
      try {
        const storedToken = window.localStorage.getItem(HOST_TOKEN_STORAGE_KEY);
        let nextSnapshot: QuizSessionSnapshot | null = null;
        if (storedToken) {
          try {
            nextSnapshot = await getQuizSession(storedToken);
          } catch {
            window.localStorage.removeItem(HOST_TOKEN_STORAGE_KEY);
          }
        }
        if (!nextSnapshot) {
          nextSnapshot = await createQuizSession();
        }
        if (!active) return;
        window.localStorage.setItem(HOST_TOKEN_STORAGE_KEY, nextSnapshot.room_token);
        setSnapshot(nextSnapshot);
        setDraft(snapshotToDraft(nextSnapshot));
      } catch (error) {
        if (active) {
          setNotice({ tone: "error", text: error instanceof Error ? error.message : "读取抢答活动失败" });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) return;

    let socket: Socket | null = connectQuizSocket();
    const join = () => {
      socket?.emit("quiz:host:join", { room_token: token });
      socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() });
    };
    const applySnapshot = (nextSnapshot: QuizSessionSnapshot) => {
      if (!nextSnapshot?.room_token) return;
      setSnapshot(nextSnapshot);
    };
    const handlePong = (payload: { client_sent_at_ms?: number; server_now_ms?: number }) => {
      if (!payload?.client_sent_at_ms || !payload.server_now_ms) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - payload.client_sent_at_ms;
      const estimatedServerNow = payload.server_now_ms + roundTrip / 2;
      setServerOffsetMs(estimatedServerNow - receivedAt);
    };
    const handleError = (payload: { message?: string }) => {
      setNotice({ tone: "error", text: payload?.message || "抢答 Socket 连接错误" });
    };

    socket.on("connect", join);
    socket.on("quiz:snapshot", applySnapshot);
    socket.on("quiz:config_updated", applySnapshot);
    socket.on("quiz:winner", applySnapshot);
    socket.on("quiz:time:pong", handlePong);
    socket.on("quiz:error", handleError);
    if (socket.connected) join();
    const pingTimer = window.setInterval(() => {
      socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() });
    }, 5000);

    return () => {
      window.clearInterval(pingTimer);
      socket?.disconnect();
      socket = null;
    };
  }, [token]);

  useEffect(() => {
    if (view === "settings" && snapshot) {
      setDraft(snapshotToDraft(snapshot));
    }
  }, [snapshot, view]);

  useEffect(() => {
    if (!guestUrl) return;
    let active = true;
    void QRCode.toDataURL(guestUrl, {
      width: 220,
      margin: 1,
      color: { dark: "#111827", light: "#ffffff" },
    }).then((dataUrl: string) => {
      if (active) setQrDataUrl(dataUrl);
    });
    return () => {
      active = false;
    };
  }, [guestUrl]);

  async function handleSaveConfig() {
    if (!token) return;
    setSaving(true);
    setNotice(null);
    try {
      const cleaned = trimDraft(draft);
      const nextSnapshot = await saveQuizConfig(token, cleaned);
      setSnapshot(nextSnapshot);
      setDraft(snapshotToDraft(nextSnapshot));
      setView("home");
      setNotice({ tone: "success", text: "抢答配置已保存" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!token) return;
    await runAction(() => publishQuizSession(token), "已发布抢答配置");
  }

  async function handleReset() {
    if (!token) return;
    await runAction(() => resetQuizSession(token), "本题抢答结果已重置");
  }

  async function handleClose() {
    if (!token) return;
    await runAction(() => closeQuizSession(token), "抢答已关闭");
  }

  async function runAction(action: () => Promise<QuizSessionSnapshot>, successText: string) {
    setSaving(true);
    setNotice(null);
    try {
      const nextSnapshot = await action();
      setSnapshot(nextSnapshot);
      setNotice({ tone: "success", text: successText });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "操作失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyGuestUrl() {
    if (!guestUrl) return;
    try {
      await navigator.clipboard.writeText(guestUrl);
      setNotice({ tone: "success", text: "游客入口已复制" });
    } catch {
      setNotice({ tone: "error", text: "复制失败" });
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={centerMessageStyle}>读取抢答活动中...</div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <header style={topBarStyle}>
          <button type="button" onClick={onBack} style={iconTextButtonStyle}>
            <i className="fas fa-arrow-left" aria-hidden="true" />
            <span>返回</span>
          </button>
          <div style={titleBlockStyle}>
            <span style={kickerStyle}>Quiz</span>
            <h1 style={h1Style}>抢答活动</h1>
          </div>
          {isAuthenticated ? (
            <button
              type="button"
              aria-label={view === "settings" ? "返回主页" : "设置"}
              title={view === "settings" ? "返回主页" : "设置"}
              onClick={() => setView(view === "settings" ? "home" : "settings")}
              style={iconButtonStyle}
            >
              <i className={view === "settings" ? "fas fa-house" : "fas fa-gear"} aria-hidden="true" />
            </button>
          ) : (
            <div aria-hidden="true" style={iconButtonPlaceholderStyle} />
          )}
        </header>

        {notice ? <div style={noticeStyle(notice.tone)}>{notice.text}</div> : null}

        {view === "settings" ? (
          /* ───────── SETTINGS VIEW ───────── */
          <section style={settingsLayoutStyle}>
            <div style={settingsMainStyle}>
              <div style={settingsCardStyle}>
                <div style={cardHeaderStyle}>
                  <i className="fas fa-clock" aria-hidden="true" style={cardIconStyle} />
                  <h2 style={cardTitleStyle}>题目设置</h2>
                </div>
                <div style={timeRowStyle}>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>抢答开始时间</span>
                    <input
                      type="datetime-local"
                      step="1"
                      value={toLocalDatetimeInput(draft.start_at_ms)}
                      onChange={(event) => updateStartDate(setDraft, event.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>毫秒</span>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={getMilliseconds(draft.start_at_ms)}
                      onChange={(event) => updateStartMilliseconds(setDraft, event.target.value)}
                      style={inputStyle}
                    />
                  </label>
                </div>
                <label style={fieldStyle}>
                  <span style={labelStyle}>题目</span>
                  <textarea
                    value={draft.question}
                    onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))}
                    rows={4}
                    style={textAreaStyle}
                  />
                </label>
              </div>

              <div style={settingsCardStyle}>
                <div style={cardHeaderStyle}>
                  <i className="fas fa-list-ol" aria-hidden="true" style={cardIconStyle} />
                  <h2 style={cardTitleStyle}>答案编辑</h2>
                </div>
                <div style={answersEditorStyle}>
                  {draft.answers.map((answer) => {
                    const isCorrect = draft.correct_answer_index === answer.index;
                    return (
                      <div key={answer.index} style={answerEditRowStyle(isCorrect)}>
                        <label style={answerCheckStyle}>
                          <input
                            type="checkbox"
                            checked={answer.enabled}
                            onChange={(event) => updateAnswer(setDraft, answer.index, { enabled: event.target.checked })}
                          />
                          <span style={answerEditNumStyle(isCorrect)}>{answer.index}</span>
                        </label>
                        <input
                          type="text"
                          value={answer.text}
                          onChange={(event) => updateAnswer(setDraft, answer.index, { text: event.target.value })}
                          placeholder={`答案 ${answer.index}`}
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => updateCorrectAnswer(setDraft, answer.index)}
                          style={correctBtnStyle(isCorrect)}
                        >
                          <i className={isCorrect ? "fas fa-check-circle" : "far fa-circle"} aria-hidden="true" />
                          <span>正确</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <aside style={guestEntryCardStyle}>
              <div style={cardHeaderStyle}>
                <i className="fas fa-qrcode" aria-hidden="true" style={cardIconStyle} />
                <h2 style={cardTitleStyle}>游客入口</h2>
              </div>
              <div style={tokenLargeStyle}>{token || "未生成"}</div>
              {qrDataUrl ? (
                <div style={qrWrapStyle}>
                  <img src={qrDataUrl} alt="游客入口二维码" style={qrImgStyle} />
                </div>
              ) : null}
              <div style={guestUrlStyle}>{guestUrl}</div>
              <div style={guestActionsStyle}>
                <button type="button" onClick={() => void handleCopyGuestUrl()} style={secondaryBtnStyle}>
                  <i className="fas fa-copy" aria-hidden="true" />
                  <span>复制链接</span>
                </button>
                <button type="button" disabled={saving} onClick={() => void handleSaveConfig()} style={primaryBtnStyle}>
                  <i className="fas fa-floppy-disk" aria-hidden="true" />
                  <span>{saving ? "保存中" : "保存配置"}</span>
                </button>
              </div>
            </aside>
          </section>
        ) : (
          /* ───────── HOME VIEW ───────── */
          <section style={homeStyle}>
            <div style={statusCenterStyle}>
              <span style={statusPillStyle(derivedStatus)}>{statusLabel(derivedStatus)}</span>
            </div>

            <div style={questionCardStyle}>
              <h2 style={questionTextStyle}>{snapshot?.config.question || "请先进入设置配置题目"}</h2>
            </div>

            <div style={countdownSectionStyle}>
              <div style={countdownValueStyle}>
                {snapshot?.winner
                  ? "已抢答"
                  : snapshot?.config.start_at_ms
                    ? derivedStatus === "open"
                      ? "抢答开放"
                      : formatDuration(remainingMs)
                    : "未设置时间"}
              </div>
            </div>

            <div style={homeAnswerGridStyle}>
              {(snapshot?.config.answers || [])
                .filter((a) => a.enabled)
                .map((answer) => {
                  const isCorrect = answer.index === snapshot?.config.correct_answer_index;
                  return (
                    <div key={answer.index} style={homeAnswerCardStyle(isCorrect)}>
                      <span style={homeAnswerNumStyle(isCorrect)}>{answer.index}</span>
                      <span style={homeAnswerTextStyle}>{answer.text}</span>
                    </div>
                  );
                })}
            </div>

            {snapshot?.winner ? (
              <div style={winnerBannerStyle(snapshot.winner.is_correct)}>
                <div style={winnerRowStyle}>
                  <i className="fas fa-trophy" aria-hidden="true" style={trophyStyle} />
                  <span style={winnerNameStyle}>{snapshot.winner.guest_name}</span>
                  <span style={winnerBadgeStyle(snapshot.winner.is_correct)}>
                    {snapshot.winner.is_correct ? "答对" : "答错"}
                  </span>
                </div>
                <div style={winnerDetailStyle}>
                  <span>
                    选择: {snapshot.winner.answer_index}. {snapshot.winner.answer_text}
                  </span>
                  <span style={winnerCorrectStyle}>
                    正确: {snapshot.winner.correct_answer_index}. {snapshot.winner.correct_answer_text}
                  </span>
                  <span style={winnerDeltaStyle}>+{snapshot.winner.delta_from_start_ms}ms</span>
                </div>
              </div>
            ) : (
              <div style={emptyResultStyle}>
                <i className="fas fa-hourglass-half" aria-hidden="true" />
                <span>等待抢答</span>
              </div>
            )}

            <div style={actionCenterStyle}>
              <button type="button" disabled={saving} onClick={() => void handlePublish()} style={actionBtnStyle("publish")}>
                <i className="fas fa-paper-plane" aria-hidden="true" />
                <span>发布</span>
              </button>
              <button type="button" disabled={saving} onClick={() => void handleReset()} style={actionBtnStyle("reset")}>
                <i className="fas fa-rotate" aria-hidden="true" />
                <span>重置</span>
              </button>
              <button type="button" disabled={saving} onClick={() => void handleClose()} style={actionBtnStyle("close")}>
                <i className="fas fa-stop" aria-hidden="true" />
                <span>关闭</span>
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/* ═══════════════════ helpers ═══════════════════ */

function createDraftConfig(): QuizConfig {
  return {
    start_at_ms: Date.now() + 60_000,
    question: "",
    correct_answer_index: 1,
    answers: Array.from({ length: MAX_ANSWERS }, (_, index) => ({
      index: index + 1,
      text: "",
      enabled: index < 4,
    })),
  };
}

function buildGuestUrl(token: string) {
  if (window.location.port === "5173") {
    return `${window.location.origin}/#/music/turntable/quiz?token=${token}`;
  }
  return `${window.location.origin}/quiz?token=${token}`;
}

function snapshotToDraft(snapshot: QuizSessionSnapshot): QuizConfig {
  const base = createDraftConfig();
  const byIndex = new Map((snapshot.config.answers || []).map((answer) => [answer.index, answer]));
  return {
    start_at_ms: snapshot.config.start_at_ms || base.start_at_ms,
    question: snapshot.config.question || "",
    correct_answer_index: snapshot.config.correct_answer_index || 1,
    answers: base.answers.map((fallback) => byIndex.get(fallback.index) || fallback),
  };
}

function trimDraft(draft: QuizConfig): QuizConfig {
  return {
    ...draft,
    question: draft.question.trim(),
    answers: draft.answers.map((answer) => ({ ...answer, text: answer.text.trim() })),
  };
}

function deriveStatus(snapshot: QuizSessionSnapshot, estimatedServerNowMs: number) {
  if (snapshot.winner) return "answered";
  if (snapshot.status === "closed") return "closed";
  if (!snapshot.config.start_at_ms || !snapshot.config.question) return "draft";
  return estimatedServerNowMs >= snapshot.config.start_at_ms ? "open" : "waiting";
}

function statusLabel(status: string) {
  if (status === "answered") return "已抢答";
  if (status === "closed") return "已关闭";
  if (status === "open") return "抢答开放";
  if (status === "waiting") return "等待开始";
  return "未配置";
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function toLocalDatetimeInput(ms: number | null) {
  const date = new Date(ms || Date.now());
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getMilliseconds(ms: number | null) {
  return new Date(ms || Date.now()).getMilliseconds();
}

function updateStartDate(setDraft: Dispatch<SetStateAction<QuizConfig>>, value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return;
  setDraft((current) => {
    parsed.setMilliseconds(getMilliseconds(current.start_at_ms));
    return { ...current, start_at_ms: parsed.getTime() };
  });
}

function updateStartMilliseconds(setDraft: Dispatch<SetStateAction<QuizConfig>>, value: string) {
  const ms = Math.max(0, Math.min(999, Number.parseInt(value || "0", 10) || 0));
  setDraft((current) => {
    const date = new Date(current.start_at_ms || Date.now());
    date.setMilliseconds(ms);
    return { ...current, start_at_ms: date.getTime() };
  });
}

function updateAnswer(
  setDraft: Dispatch<SetStateAction<QuizConfig>>,
  index: number,
  patch: Partial<QuizAnswer>,
) {
  setDraft((current) => ({
    ...current,
    answers: current.answers.map((answer) => (answer.index === index ? { ...answer, ...patch } : answer)),
  }));
}

function updateCorrectAnswer(setDraft: Dispatch<SetStateAction<QuizConfig>>, index: number) {
  setDraft((current) => ({
    ...current,
    correct_answer_index: index,
    answers: current.answers.map((answer) => (answer.index === index ? { ...answer, enabled: true } : answer)),
  }));
}

function formatDuration(ms: number) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milliseconds = Math.floor(total % 1000);
  return `${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

/* ═══════════════════ styles ═══════════════════ */

/* ── shared ── */

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
};

const shellStyle: CSSProperties = {
  width: "min(1180px, calc(100% - 32px))",
  margin: "0 auto",
  padding: "18px 0 32px",
};

const topBarStyle: CSSProperties = {
  minHeight: "54px",
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "14px",
};

const titleBlockStyle: CSSProperties = { textAlign: "center" };

const kickerStyle: CSSProperties = {
  display: "block",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 800,
  textTransform: "uppercase",
};

const h1Style: CSSProperties = { margin: 0, fontSize: "24px", lineHeight: 1.15 };

const iconButtonStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontSize: "18px",
};

const iconButtonPlaceholderStyle: CSSProperties = { width: "44px", height: "44px" };

const iconTextButtonStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 800,
};

const noticeStyle = (tone: Notice["tone"]): CSSProperties => ({
  margin: "12px 0",
  padding: "12px 14px",
  borderRadius: "8px",
  background:
    tone === "error" ? "var(--x-color-danger-soft)" : tone === "success" ? "var(--x-color-success-soft)" : "var(--x-color-info-soft)",
  color: tone === "error" ? "var(--x-color-danger)" : tone === "success" ? "var(--x-color-success)" : "var(--x-color-info)",
  fontWeight: 700,
});

const centerMessageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };

const labelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 800,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "42px",
  boxSizing: "border-box",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 12px",
  color: "var(--x-color-ink)",
  background: "white",
  fontSize: "15px",
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "110px",
  padding: "10px 12px",
  resize: "vertical",
};

/* ── home view ── */

const homeStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
  justifyItems: "center",
};

const statusCenterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

const statusPillStyle = (status: string): CSSProperties => ({
  padding: "8px 18px",
  borderRadius: "999px",
  fontWeight: 900,
  fontSize: "14px",
  ...(status === "open"
    ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
    : status === "answered"
      ? { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" }
      : status === "closed"
        ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
        : { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" }),
});

const questionCardStyle: CSSProperties = {
  width: "100%",
  padding: "32px 28px",
  borderRadius: "12px",
  background: "linear-gradient(135deg, var(--x-color-panel), var(--x-color-panel-alt))",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 8px 24px var(--x-color-shadow-soft)",
};

const questionTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "40px",
  lineHeight: 1.15,
  textAlign: "center",
  overflowWrap: "anywhere",
};

const countdownSectionStyle: CSSProperties = {
  padding: "18px 0",
};

const countdownValueStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontSize: "64px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  textAlign: "center",
  overflowWrap: "anywhere",
};

const homeAnswerGridStyle: CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "14px",
};

const homeAnswerCardStyle = (correct: boolean): CSSProperties => ({
  minHeight: "76px",
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "14px 18px",
  borderRadius: "12px",
  border: correct ? "2px solid var(--x-color-success)" : "1px solid var(--x-color-line)",
  background: correct
    ? "linear-gradient(135deg, var(--x-color-success-soft), rgba(21,128,61,0.08))"
    : "var(--x-color-panel)",
  boxShadow: correct ? "0 6px 18px rgba(21,128,61,0.12)" : "0 4px 12px var(--x-color-shadow-soft)",
  transition: "transform 0.15s, box-shadow 0.15s",
});

const homeAnswerNumStyle = (correct: boolean): CSSProperties => ({
  width: "40px",
  height: "40px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  fontWeight: 900,
  fontSize: "16px",
  background: correct ? "var(--x-color-success)" : "var(--x-color-ink)",
  color: "white",
});

const homeAnswerTextStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
};

const winnerBannerStyle = (correct: boolean): CSSProperties => ({
  width: "100%",
  padding: "22px 28px",
  borderRadius: "12px",
  border: `2px solid ${correct ? "rgba(21,128,61,0.3)" : "rgba(194,65,12,0.3)"}`,
  background: correct
    ? "linear-gradient(135deg, var(--x-color-success-soft), rgba(21,128,61,0.06))"
    : "linear-gradient(135deg, var(--x-color-danger-soft), rgba(194,65,12,0.06))",
  boxShadow: correct ? "0 8px 24px rgba(21,128,61,0.1)" : "0 8px 24px rgba(194,65,12,0.1)",
  display: "grid",
  gap: "12px",
});

const winnerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
};

const trophyStyle: CSSProperties = {
  fontSize: "28px",
  color: "#d97706",
};

const winnerNameStyle: CSSProperties = {
  fontSize: "28px",
  fontWeight: 900,
};

const winnerBadgeStyle = (correct: boolean): CSSProperties => ({
  padding: "4px 12px",
  borderRadius: "999px",
  fontWeight: 900,
  fontSize: "14px",
  background: correct ? "var(--x-color-success)" : "var(--x-color-danger)",
  color: "white",
});

const winnerDetailStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "18px",
  flexWrap: "wrap",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

const winnerCorrectStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
};

const winnerDeltaStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontWeight: 900,
  color: "var(--x-color-accent)",
};

const emptyResultStyle: CSSProperties = {
  width: "100%",
  minHeight: "100px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  border: "2px dashed var(--x-color-line)",
  borderRadius: "12px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
  fontSize: "16px",
};

const actionCenterStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  justifyContent: "center",
  flexWrap: "wrap",
};

const actionBtnStyle = (variant: "publish" | "reset" | "close"): CSSProperties => ({
  minHeight: "46px",
  minWidth: "110px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 18px",
  borderRadius: "8px",
  fontWeight: 900,
  cursor: "pointer",
  ...(variant === "publish"
    ? {
        border: "1px solid var(--x-color-accent)",
        background: "var(--x-color-accent)",
        color: "white",
      }
    : variant === "close"
      ? {
          border: "1px solid var(--x-color-danger)",
          background: "var(--x-color-danger-soft)",
          color: "var(--x-color-danger)",
        }
      : {
          border: "1px solid var(--x-color-line)",
          background: "var(--x-color-panel-alt)",
          color: "var(--x-color-ink)",
        }),
});

/* ── settings view ── */

const settingsLayoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 320px",
  gap: "18px",
  alignItems: "start",
};

const settingsMainStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const settingsCardStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  padding: "22px",
  display: "grid",
  gap: "16px",
};

const cardHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const cardIconStyle: CSSProperties = {
  fontSize: "18px",
  color: "var(--x-color-accent)",
};

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "18px",
};

const timeRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 120px",
  gap: "12px",
};

const answersEditorStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const answerEditRowStyle = (correct: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: "56px minmax(0, 1fr) 80px",
  gap: "8px",
  alignItems: "center",
  padding: "4px 0",
  borderRadius: "8px",
  background: correct ? "var(--x-color-success-soft)" : "transparent",
  transition: "background 0.15s",
});

const answerCheckStyle: CSSProperties = {
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
};

const answerEditNumStyle = (correct: boolean): CSSProperties => ({
  width: "26px",
  height: "26px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  fontSize: "13px",
  fontWeight: 900,
  background: correct ? "var(--x-color-success)" : "var(--x-color-line)",
  color: correct ? "white" : "var(--x-color-ink)",
});

const correctBtnStyle = (active: boolean): CSSProperties => ({
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "5px",
  border: "none",
  borderRadius: "8px",
  background: "transparent",
  color: active ? "var(--x-color-success)" : "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 800,
  cursor: "pointer",
});

const guestEntryCardStyle: CSSProperties = {
  position: "sticky",
  top: "18px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  padding: "22px",
  display: "grid",
  gap: "16px",
  justifyItems: "center",
};

const tokenLargeStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontSize: "32px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  letterSpacing: "0.06em",
};

const qrWrapStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "12px",
  background: "white",
  border: "1px solid var(--x-color-line)",
};

const qrImgStyle: CSSProperties = {
  width: "180px",
  height: "180px",
  display: "block",
};

const guestUrlStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  overflowWrap: "anywhere",
  fontSize: "12px",
  textAlign: "center",
};

const guestActionsStyle: CSSProperties = {
  width: "100%",
  display: "grid",
  gap: "8px",
};

const primaryBtnStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 16px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "8px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryBtnStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  cursor: "pointer",
};
