import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../../app/UserState";
import { CachedImage } from "../../../components/CachedMedia";
import {
  buildDefaultSlots,
  buildRollingPicks,
  buildRoundResult,
  checkCanStart,
  clampSlotCount,
  displayUserName,
} from "./turntableRandom";
import { TurntableSettingsPanel } from "./TurntableSettingsPanel";
import type { SlotMachineRoundResult, SlotMachineSettings, SlotUser } from "./types";

const SETTINGS_KEY = "xinya.slotmachine.settings";
const USED_IDS_KEY = "xinya.slotmachine.usedIdsPerSlot";
const RESULT_KEY = "xinya.slotmachine.currentResult";

type ViewMode = "home" | "settings";
type Notice = { tone: "success" | "error" | "info"; text: string };

export function TurntableSpinnerPage({ onBack }: { onBack: () => void }) {
  const { isAuthenticated } = useUserState();
  const [settings, setSettings] = useState<SlotMachineSettings>(() => loadSettings());
  const [usedIdsPerSlot, setUsedIdsPerSlot] = useState<number[][]>(() => loadUsedIds());
  const [currentResult, setCurrentResult] = useState<SlotMachineRoundResult | null>(() => loadResult());
  const [rollingPicks, setRollingPicks] = useState<(SlotUser | null)[] | null>(null);
  const [pendingResult, setPendingResult] = useState<SlotMachineRoundResult | null>(null);
  const [stoppedSlots, setStoppedSlots] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [spinning, setSpinning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);

  const slotCount = clampSlotCount(settings.slot_count);
  const startCheck = checkCanStart(settings, usedIdsPerSlot);
  const canStart = !spinning && startCheck.ok;

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(USED_IDS_KEY, JSON.stringify(usedIdsPerSlot));
  }, [usedIdsPerSlot]);

  useEffect(() => {
    if (currentResult) localStorage.setItem(RESULT_KEY, JSON.stringify(currentResult));
    else localStorage.removeItem(RESULT_KEY);
  }, [currentResult]);

  useEffect(() => {
    if (!isAuthenticated && viewMode === "settings") setViewMode("home");
  }, [isAuthenticated, viewMode]);

  useEffect(() => () => stopTimers(), []);

  function stopTimers() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }

  function handleStart() {
    stopTimers();
    setNotice(null);

    let result: SlotMachineRoundResult;
    try {
      result = buildRoundResult(settings, usedIdsPerSlot);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "抽取失败" });
      return;
    }

    setSpinning(true);
    setPendingResult(result);
    setCurrentResult(null);
    setStoppedSlots(new Set());
    setRollingPicks(buildRollingPicks(settings));

    intervalRef.current = window.setInterval(() => {
      setRollingPicks(buildRollingPicks(settings));
    }, 80);

    for (let i = 0; i < slotCount; i++) {
      const delay = 1000 + i * 350;
      timersRef.current.push(
        window.setTimeout(() => {
          setStoppedSlots((prev) => new Set([...prev, i]));
        }, delay),
      );
    }

    const finalDelay = 1000 + (slotCount - 1) * 350 + 400;
    timersRef.current.push(
      window.setTimeout(() => {
        stopTimers();
        setRollingPicks(null);
        setPendingResult(null);
        setStoppedSlots(new Set());
        setCurrentResult(result);
        setSpinning(false);

        if (!settings.return_after_drawn) {
          setUsedIdsPerSlot((prev) => {
            const next = [...prev];
            result.picks.forEach((pick, i) => {
              const used = new Set(next[i] || []);
              used.add(pick.id);
              next[i] = [...used];
            });
            return next;
          });
        }
        setNotice({ tone: "success", text: "乐团组建完成！" });
      }, finalDelay),
    );
  }

  function handleClear() {
    stopTimers();
    setSpinning(false);
    setRollingPicks(null);
    setPendingResult(null);
    setStoppedSlots(new Set());
    setCurrentResult(null);
    setNotice({ tone: "info", text: "当前结果已清空" });
  }

  function handleResetUsed() {
    setUsedIdsPerSlot([]);
    setNotice({ tone: "success", text: "已使用名单已重置" });
  }

  function handleSave(next: SlotMachineSettings) {
    const normalized: SlotMachineSettings = {
      ...next,
      slot_count: clampSlotCount(next.slot_count),
      slots: next.slots.slice(0, clampSlotCount(next.slot_count)),
    };
    const changed =
      normalized.slot_count !== settings.slot_count || slotsSignature(normalized.slots) !== slotsSignature(settings.slots);

    const cleanedUsedIds = normalized.slots.map((slot, i) => {
      const ids = new Set(slot.candidates.map((u) => u.id));
      return (usedIdsPerSlot[i] || []).filter((id) => ids.has(id));
    });

    setSettings(normalized);
    setUsedIdsPerSlot(cleanedUsedIds);
    if (changed) setCurrentResult(null);
    setViewMode("home");
    setNotice({ tone: "success", text: "配置已保存" });
  }

  function getSlotDisplay(i: number): { user: SlotUser | null; rolling: boolean } {
    if (spinning) {
      if (stoppedSlots.has(i) && pendingResult) {
        return { user: pendingResult.picks[i], rolling: false };
      }
      if (rollingPicks) {
        return { user: rollingPicks[i] || null, rolling: true };
      }
    }
    if (currentResult) {
      return { user: currentResult.picks[i] || null, rolling: false };
    }
    return { user: null, rolling: false };
  }

  const hasAnyCandidates = settings.slots.some((s) => s.candidates.length > 0);

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <header style={topBarStyle}>
          <button type="button" onClick={onBack} style={iconTextButtonStyle}>
            <i className="fas fa-arrow-left" aria-hidden="true" />
            <span>返回</span>
          </button>
          <div style={titleBlockStyle}>
            <span style={kickerStyle}>Slot Machine</span>
            <h1 style={h1Style}>组乐团</h1>
          </div>
          {isAuthenticated ? (
            <button
              type="button"
              aria-label={viewMode === "settings" ? "返回主页" : "设置"}
              title={viewMode === "settings" ? "返回主页" : "设置"}
              onClick={() => setViewMode(viewMode === "settings" ? "home" : "settings")}
              style={iconButtonStyle}
            >
              <i className={viewMode === "settings" ? "fas fa-house" : "fas fa-gear"} aria-hidden="true" />
            </button>
          ) : (
            <div aria-hidden="true" style={iconButtonPlaceholderStyle} />
          )}
        </header>

        {notice ? <div style={noticeStyle(notice.tone)}>{notice.text}</div> : null}

        {viewMode === "settings" ? (
          <TurntableSettingsPanel settings={settings} onCancel={() => setViewMode("home")} onSave={handleSave} />
        ) : (
          <section style={homeStyle}>
            <div style={statusRowStyle}>
              <span style={statusPillStyle(spinning)}>
                {spinning
                  ? "抽取中"
                  : !hasAnyCandidates
                    ? "未配置"
                    : !startCheck.ok
                      ? "候选人不足"
                      : currentResult
                        ? "已完成"
                        : "准备抽取"}
              </span>
              <span style={metaTextStyle}>
                {slotCount} 个角色{!settings.return_after_drawn ? " · 抽中不返回" : " · 抽中返回"}
                {settings.unique_per_round ? " · 不重复" : ""}
              </span>
            </div>

            <div style={slotsRowStyle}>
              {Array.from({ length: slotCount }, (_, i) => {
                const slot = settings.slots[i];
                const slotName = slot?.name || `角色 ${i + 1}`;
                const { user, rolling } = getSlotDisplay(i);
                const justStopped = spinning && stoppedSlots.has(i);

                return (
                  <article key={i} style={slotCardStyle(rolling, justStopped)}>
                    <div style={slotLabelStyle}>{slotName}</div>
                    <div style={slotBodyStyle}>
                      {user ? (
                        <div style={userDisplayStyle}>
                          {!rolling ? (
                            <CachedImage
                              src={`/api/user_control/get_profile_image/${user.id}`}
                              cacheKey={`slot-user:${user.id}`}
                              resolveRelativeToApi
                              alt=""
                              style={slotAvatarStyle}
                            />
                          ) : (
                            <div style={rollingAvatarPlaceholderStyle} />
                          )}
                          <div style={slotUserNameStyle(rolling)}>{displayUserName(user)}</div>
                        </div>
                      ) : (
                        <div style={questionMarkStyle}>?</div>
                      )}
                    </div>
                    <div style={slotFooterStyle}>{slot ? `${slot.candidates.length} 人候选` : "未配置"}</div>
                  </article>
                );
              })}
            </div>

            <div style={actionAreaStyle}>
              {!canStart && !spinning && startCheck.reason ? <div style={warningStyle}>{startCheck.reason}</div> : null}
              <div style={buttonGroupStyle}>
                <button type="button" disabled={!canStart} onClick={handleStart} style={primaryBtnStyle(canStart)}>
                  <i className="fas fa-play" aria-hidden="true" />
                  <span>{currentResult ? "重抽" : "开始"}</span>
                </button>
                <button type="button" disabled={spinning} onClick={handleClear} style={secondaryBtnStyle}>
                  清空结果
                </button>
                {!settings.return_after_drawn ? (
                  <button type="button" disabled={spinning} onClick={handleResetUsed} style={secondaryBtnStyle}>
                    重置已使用名单
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/* ---------- helpers ---------- */

function defaultSettings(): SlotMachineSettings {
  return { slot_count: 3, slots: buildDefaultSlots(3), return_after_drawn: true, unique_per_round: true };
}

function loadSettings(): SlotMachineSettings {
  try {
    const p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "");
    if (!p || !Array.isArray(p.slots)) return defaultSettings();
    return {
      slot_count: clampSlotCount(Number(p.slot_count)),
      slots: p.slots
        .filter((s: { name?: unknown; candidates?: unknown }) => s && typeof s.name === "string" && Array.isArray(s.candidates))
        .map((s: { name: string; candidates: SlotUser[] }) => ({
          name: s.name,
          candidates: s.candidates.filter((u: SlotUser) => u && typeof u.id === "number"),
        })),
      return_after_drawn: Boolean(p.return_after_drawn),
      unique_per_round: p.unique_per_round !== false,
    };
  } catch {
    return defaultSettings();
  }
}

function loadUsedIds(): number[][] {
  try {
    const p = JSON.parse(localStorage.getItem(USED_IDS_KEY) || "[]");
    return Array.isArray(p)
      ? p.map((arr: unknown) => (Array.isArray(arr) ? arr.filter((id: unknown) => typeof id === "number") : []))
      : [];
  } catch {
    return [];
  }
}

function loadResult(): SlotMachineRoundResult | null {
  try {
    const p = JSON.parse(localStorage.getItem(RESULT_KEY) || "null");
    if (!p || !Array.isArray(p.picks)) return null;
    return p;
  } catch {
    return null;
  }
}

function slotsSignature(slots: SlotMachineSettings["slots"]) {
  return slots
    .map((s) => `${s.name}:${s.candidates.map((u) => u.id).sort((a, b) => a - b).join(",")}`)
    .join("|");
}

/* ---------- styles ---------- */

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
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
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
    tone === "error"
      ? "var(--x-color-danger-soft)"
      : tone === "success"
        ? "var(--x-color-success-soft)"
        : "var(--x-color-info-soft)",
  color:
    tone === "error" ? "var(--x-color-danger)" : tone === "success" ? "var(--x-color-success)" : "var(--x-color-info)",
  fontWeight: 800,
});

const homeStyle: CSSProperties = {
  display: "grid",
  gap: "22px",
};

const statusRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
};

const statusPillStyle = (active: boolean): CSSProperties => ({
  padding: "8px 12px",
  borderRadius: "999px",
  background: active ? "var(--x-color-warning-soft)" : "var(--x-color-accent-soft)",
  color: active ? "var(--x-color-warning)" : "var(--x-color-accent-strong)",
  fontWeight: 900,
});

const metaTextStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 800 };

const slotsRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "14px",
};

const slotCardStyle = (rolling: boolean, justStopped: boolean): CSSProperties => ({
  minHeight: "280px",
  display: "grid",
  gridTemplateRows: "auto 1fr auto",
  gap: "8px",
  padding: "18px 14px",
  borderRadius: "12px",
  border: rolling
    ? "2px solid var(--x-color-accent)"
    : justStopped
      ? "2px solid var(--x-color-success)"
      : "1px solid var(--x-color-line)",
  background: justStopped
    ? "var(--x-color-success-soft)"
    : "linear-gradient(180deg, var(--x-color-panel), var(--x-color-panel-alt))",
  boxShadow: rolling
    ? "0 18px 40px var(--x-color-shadow-medium)"
    : justStopped
      ? "0 14px 32px var(--x-color-shadow-medium)"
      : "0 12px 28px var(--x-color-shadow-soft)",
  transition: "border-color 0.25s, background 0.25s, box-shadow 0.25s",
});

const slotLabelStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 900,
  fontSize: "14px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const slotBodyStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
};

const userDisplayStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: "10px",
};

const slotAvatarStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "999px",
  objectFit: "cover",
  border: "3px solid var(--x-color-accent)",
  background: "var(--x-color-panel-alt)",
};

const rollingAvatarPlaceholderStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "999px",
  background: "var(--x-color-accent-soft)",
};

const slotUserNameStyle = (rolling: boolean): CSSProperties => ({
  fontSize: rolling ? "18px" : "20px",
  fontWeight: 900,
  textAlign: "center",
  overflowWrap: "anywhere",
  color: rolling ? "var(--x-color-accent)" : "var(--x-color-ink)",
  transition: "color 0.2s",
});

const questionMarkStyle: CSSProperties = {
  fontSize: "86px",
  lineHeight: 1,
  fontWeight: 900,
  color: "var(--x-color-accent)",
};

const slotFooterStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 800,
};

const actionAreaStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  justifyItems: "center",
};

const warningStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "8px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
  textAlign: "center",
};

const buttonGroupStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  justifyContent: "center",
};

const primaryBtnStyle = (enabled: boolean): CSSProperties => ({
  minHeight: "48px",
  minWidth: "120px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 22px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "8px",
  background: enabled ? "var(--x-color-accent)" : "var(--x-color-line)",
  color: "white",
  fontWeight: 900,
  fontSize: "16px",
  cursor: enabled ? "pointer" : "not-allowed",
});

const secondaryBtnStyle: CSSProperties = {
  minHeight: "44px",
  padding: "0 16px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  cursor: "pointer",
};
