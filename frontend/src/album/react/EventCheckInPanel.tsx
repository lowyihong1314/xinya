import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";

import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { createEventCheckInQr, deleteEventCheckIn, saveEventCheckIn, scanEventCheckInQr } from "../../event/shared/api";
import type { EventCheckInQrRecord, EventCheckInRecord, EventDetailRecord } from "../../event/shared/types";
import { apiFetch } from "../../js/apiFetch";

type UserRecord = {
  id: number;
  username?: string;
  display_name?: string;
};

type EventCheckInPanelProps = {
  detail: EventDetailRecord;
  isMobile: boolean;
  onChanged: () => Promise<void> | void;
};

export function EventCheckInPanel(props: EventCheckInPanelProps) {
  if (props.isMobile) {
    return <MobileEventCheckInPanel detail={props.detail} onChanged={props.onChanged} />;
  }
  return <DesktopEventCheckInPanel {...props} />;
}

function DesktopEventCheckInPanel({
  detail,
  isMobile,
  onChanged,
}: EventCheckInPanelProps) {
  const { user } = useUserState();
  const currentUserId = asNumber(user?.id);
  const minDate = getEventBoundaryDate(detail.datetime);
  const maxDate = getEventBoundaryDate(detail.end_datetime || detail.datetime);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => clampDateToRange(new Date().toISOString().slice(0, 10), minDate, maxDate));
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedDate((current) => clampDateToRange(current, minDate, maxDate));
  }, [maxDate, minDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setLoadingUsers(true);
      try {
        const response = await apiFetch("/api/user_control/get_all_user_data", {
          credentials: "include",
        });
        const payload = (await response.json().catch(() => ({}))) as { data?: UserRecord[]; error?: string; message?: string };
        if (!response.ok) {
          throw new Error(payload.error || payload.message || "读取成员失败");
        }
        if (!cancelled) {
          setUsers(Array.isArray(payload.data) ? payload.data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "读取成员失败");
        }
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDayCheckIns = useMemo(() => {
    const targetDate = selectedDate;
    return (detail.check_ins || []).filter((item) => item.check_in_date === targetDate);
  }, [detail.check_ins, selectedDate]);

  const checkInMap = useMemo(() => {
    return new Map<number, EventCheckInRecord>(selectedDayCheckIns.map((item) => [item.user_id, item]));
  }, [selectedDayCheckIns]);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const sorted = [...users].sort((left, right) => {
      const leftChecked = checkInMap.has(left.id) ? 1 : 0;
      const rightChecked = checkInMap.has(right.id) ? 1 : 0;
      if (leftChecked !== rightChecked) {
        return rightChecked - leftChecked;
      }
      return String(left.display_name || left.username || left.id).localeCompare(
        String(right.display_name || right.username || right.id),
      );
    });

    if (!keyword) {
      return sorted;
    }

    return sorted.filter((user) =>
      [user.display_name, user.username, user.id].some((value) => String(value ?? "").toLowerCase().includes(keyword)),
    );
  }, [checkInMap, query, users]);

  const checkedCount = selectedDayCheckIns.length;

  async function toggle(target: UserRecord) {
    const existing = checkInMap.get(target.id) || null;
    setSavingId(target.id);
    setError(null);
    try {
      if (existing?.id) {
        await deleteEventCheckIn(existing.id);
      } else {
        await saveEventCheckIn({
          event_id: detail.id,
          user_id: target.id,
          check_in_date: selectedDate,
          valid_user_id: currentUserId,
        });
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section id="event-detail-checkin-panel" className="event-checkin" style={deskWrapStyle}>
      <div id="event-detail-checkin-statsbar" style={deskStatsBarStyle}>
        <div id="event-detail-checkin-stat" style={deskStatChipStyle}>
          <span style={deskStatNumStyle}>{checkedCount}</span>
          <span style={deskStatLabelStyle}>/ {users.length} 人已签到</span>
        </div>
        <div style={{ flex: 1 }} />
        <input
          className="event-checkin__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索成员"
          style={deskSearchStyle}
        />
        <input
          className="event-checkin__date"
          type="date"
          value={selectedDate}
          min={minDate}
          max={maxDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          style={dateStyle}
        />
      </div>

      {error ? <div id="event-detail-checkin-error" style={errorStyle}>{error}</div> : null}

      <div id="event-detail-checkin-user-grid" style={deskGridStyle}>
        {loadingUsers ? <div id="event-detail-checkin-loading-users" style={placeholderStyle}>读取成员中…</div> : null}
        {!loadingUsers && !filteredUsers.length ? <div style={placeholderStyle}>没有匹配的成员</div> : null}
        {!loadingUsers &&
          filteredUsers.map((member) => {
            const checkIn = checkInMap.get(member.id) || null;
            const checked = Boolean(checkIn);
            const busy = savingId === member.id;
            return (
              <div key={member.id} className="event-checkin__user-card" style={deskCardStyle(checked)}>
                <CachedImage
                  src={`/api/user_control/get_profile_image/${member.id}`}
                  cacheKey={`event-checkin-user:${member.id}`}
                  resolveRelativeToApi
                  alt=""
                  style={avatarStyle(checked)}
                />
                <div id={`event-detail-checkin-user-${member.id}-name`} style={userNameStyle}>{member.display_name || member.username || `用户 ${member.id}`}</div>
                <div id={`event-detail-checkin-user-${member.id}-meta`} style={userMetaStyle}>
                  {checked
                    ? `${formatDateTime(checkIn?.check_in_time) || "已签到"} · ${checkInHelperLabel(checkIn)}`
                    : "未签到"}
                </div>
                <button
                  type="button"
                  style={checked ? deskUndoBtnStyle : deskGoBtnStyle}
                  disabled={busy}
                  onClick={() => void toggle(member)}
                >
                  {busy ? "…" : checked ? "撤回" : "签到"}
                </button>
              </div>
            );
          })}
      </div>
    </section>
  );
}

function MobileEventCheckInPanel({
  detail,
  onChanged,
}: {
  detail: EventDetailRecord;
  onChanged: () => Promise<void> | void;
}) {
  const { isAuthenticated, openLogin, user } = useUserState();
  const [activeTab, setActiveTab] = useState<"scan" | "code">("scan");
  const [qrRecord, setQrRecord] = useState<EventCheckInQrRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [statusText, setStatusText] = useState("准备打开相机扫码");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const processingScanRef = useRef(false);

  const stopScanner = useCallback(() => {
    if (animationRef.current != null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleScannedCode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || processingScanRef.current) {
        return;
      }

      processingScanRef.current = true;
      setBusy(true);
      setError(null);
      setMessage(null);
      setStatusText("识别到 QR，正在签到…");

      try {
        const payload = await scanEventCheckInQr(detail.id, trimmed);
        const helper = payload.data?.valid_user_name ? `由 ${payload.data.valid_user_name} 帮你签到` : "签到成功";
        setMessage(helper);
        setStatusText("签到成功，可以继续扫码");
        await onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "扫码签到失败");
        setStatusText("扫码失败，可以继续扫描");
      } finally {
        setBusy(false);
        window.setTimeout(() => {
          processingScanRef.current = false;
        }, 1200);
      }
    },
    [detail.id, onChanged],
  );

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (video && canvas && context && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const result = jsQR(imageData.data, width, height);
      if (result?.data) {
        void handleScannedCode(result.data);
      }
    }
    animationRef.current = window.requestAnimationFrame(scanFrame);
  }, [handleScannedCode]);

  const startScanner = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusText("这个浏览器不支持相机扫码，可以粘贴 QR 内容");
      return;
    }

    try {
      setStatusText("正在打开相机…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatusText("请扫描对方的临时签到 QR");
      animationRef.current = window.requestAnimationFrame(scanFrame);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法打开相机");
      setStatusText("相机不可用，可以粘贴 QR 内容");
    }
  }, [scanFrame]);

  useEffect(() => {
    if (!isAuthenticated || activeTab !== "scan") {
      stopScanner();
      return undefined;
    }

    void startScanner();
    return stopScanner;
  }, [activeTab, isAuthenticated, startScanner, stopScanner]);

  async function refreshQrCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await createEventCheckInQr(detail.id);
      const record = payload.data;
      if (!record?.code) {
        throw new Error(payload.message || "生成 QR 失败");
      }
      setQrRecord(record);
      setQrDataUrl(await QRCode.toDataURL(record.code, { width: 280, margin: 1 }));
      setMessage("临时签到 QR 已生成");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成 QR 失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (activeTab === "code" && isAuthenticated && !qrRecord && !busy) {
      void refreshQrCode();
    }
  }, [activeTab, busy, isAuthenticated, qrRecord]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!isAuthenticated) {
    return (
      <section id="event-detail-mobile-checkin-login-panel" style={mobileWrapStyle}>
        <div id="event-detail-mobile-checkin-login-title" style={mobileTitleStyle}>活动签到</div>
        <div id="event-detail-mobile-checkin-login-hint" style={mobileHintStyle}>请先登录，再使用手机扫码签到。</div>
        <button type="button" style={primaryButtonStyle} onClick={() => openLogin(window.location.pathname + window.location.search)}>
          登录后签到
        </button>
      </section>
    );
  }

  const currentUserName = String(user?.display_name || user?.username || "我");
  const qrSecondsLeft = qrRecord?.expires_at
    ? Math.max(0, Math.ceil((new Date(qrRecord.expires_at).getTime() - nowTick) / 1000))
    : null;

  return (
    <section id="event-detail-mobile-checkin-panel" style={mobileWrapStyle}>
      <div id="event-detail-mobile-checkin-header" style={mobileHeaderStyle}>
        <div id="event-detail-mobile-checkin-title-block">
          <div id="event-detail-mobile-checkin-eyebrow" style={mobileEyebrowStyle}>Check-in</div>
          <div id="event-detail-mobile-checkin-title" style={mobileTitleStyle}>活动签到</div>
        </div>
        <div id="event-detail-mobile-checkin-user" style={mobileUserPillStyle}>{currentUserName}</div>
      </div>

      <div id="event-detail-mobile-checkin-tabs" style={mobileTabStyle}>
        <button type="button" style={mobileTabButtonStyle(activeTab === "scan")} onClick={() => setActiveTab("scan")}>
          我要签到
        </button>
        <button type="button" style={mobileTabButtonStyle(activeTab === "code")} onClick={() => setActiveTab("code")}>
          和我签到
        </button>
      </div>

      {error ? <div id="event-detail-mobile-checkin-error" style={errorStyle}>{error}</div> : null}
      {message ? <div id="event-detail-mobile-checkin-message" style={mobileSuccessStyle}>{message}</div> : null}

      {activeTab === "scan" ? (
        <div id="event-detail-mobile-checkin-scanner-panel" style={scannerPanelStyle}>
          <div id="event-detail-mobile-checkin-scanner-frame" style={scannerFrameStyle}>
            <video ref={videoRef} muted playsInline style={scannerVideoStyle} />
            <div id="event-detail-mobile-checkin-scanner-overlay" style={scannerOverlayStyle} />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>
          <div id="event-detail-mobile-checkin-scanner-status" style={mobileHintStyle}>{busy ? "处理中…" : statusText}</div>
          <div id="event-detail-mobile-checkin-manual-scan" style={manualScanStyle}>
            <input
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="也可以粘贴 QR 内容"
              style={manualInputStyle}
            />
            <button type="button" style={secondaryButtonStyle} disabled={!manualCode.trim() || busy} onClick={() => void handleScannedCode(manualCode)}>
              签到
            </button>
          </div>
        </div>
      ) : (
        <div id="event-detail-mobile-checkin-code-panel" style={codePanelStyle}>
          <div id="event-detail-mobile-checkin-qr-box" style={qrBoxStyle}>
            {qrDataUrl ? <CachedImage src={qrDataUrl} alt="临时签到 QR" style={qrImageStyle} /> : <div id="event-detail-mobile-checkin-qr-loading" style={placeholderStyle}>生成 QR 中…</div>}
          </div>
          <div id="event-detail-mobile-checkin-qr-hint" style={mobileHintStyle}>
            让对方扫描这个 QR，对方会由你帮忙完成签到。
            {qrSecondsLeft != null ? ` 剩余 ${qrSecondsLeft} 秒。` : ""}
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => void refreshQrCode()} disabled={busy}>
            {busy ? "生成中…" : "重新生成临时 QR"}
          </button>
        </div>
      )}
    </section>
  );
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
}

function getEventBoundaryDate(value?: string) {
  return value?.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

function clampDateToRange(value: string, minDate: string, maxDate: string) {
  if (value < minDate) {
    return minDate;
  }
  if (value > maxDate) {
    return maxDate;
  }
  return value;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function checkInHelperLabel(checkIn?: EventCheckInRecord | null) {
  if (!checkIn) {
    return "未签到";
  }
  return checkIn.valid_user_name ? `由 ${checkIn.valid_user_name} 帮签` : "已签到";
}

const glassContainerStyle: CSSProperties = {
  boxSizing: "border-box",
  borderRadius: "var(--x-radius-md)",
  background: "linear-gradient(180deg, var(--x-color-panel), var(--x-color-panel-alt))",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 24px 60px var(--x-color-shadow-soft), inset 0 1px 0 var(--x-color-line)",
  backdropFilter: "blur(22px) saturate(140%)",
  color: "var(--x-color-ink)",
};

const glassInsetStyle: CSSProperties = {
  boxSizing: "border-box",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "inset 0 1px 0 var(--x-color-line), 0 12px 28px var(--x-color-shadow-soft)",
  backdropFilter: "blur(14px) saturate(130%)",
};

const glassButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
  backdropFilter: "blur(14px) saturate(130%)",
};

// —— 电脑版签到（统计头 + 内联切换网格）——
const deskWrapStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
  padding: "22px 24px",
  minHeight: "680px",
};

const deskStatsBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  paddingBottom: "14px",
  borderBottom: "1px solid var(--x-color-line)",
};

const deskStatChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: "6px",
  padding: "8px 14px",
  borderRadius: "999px",
  background: "var(--x-color-accent-soft)",
  border: "1px solid var(--x-color-accent-border)",
};

const deskStatNumStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "var(--x-color-accent-strong)",
  lineHeight: 1,
};

const deskStatLabelStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const deskSearchStyle: CSSProperties = {
  minWidth: "180px",
  padding: "10px 14px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

const deskGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: "14px",
  alignContent: "start",
};

function deskCardStyle(checked: boolean): CSSProperties {
  return {
    display: "grid",
    justifyItems: "center",
    gap: "8px",
    padding: "16px 12px 12px",
    borderRadius: "var(--x-radius-md)",
    border: checked ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line)",
    background: checked ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    boxShadow: "0 8px 20px var(--x-color-shadow-soft)",
  };
}

const deskGoBtnStyle: CSSProperties = {
  width: "100%",
  padding: "8px 0",
  borderRadius: "var(--x-radius-sm)",
  border: "none",
  background: "var(--x-color-accent)",
  color: "#ffffff",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const deskUndoBtnStyle: CSSProperties = {
  width: "100%",
  padding: "8px 0",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

function wrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "16px",
    padding: isMobile ? "18px" : "20px",
    ...glassContainerStyle,
    minHeight: "680px",
  };
}

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
  };
}

const searchStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  ...glassButtonStyle,
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

const dateStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  ...glassButtonStyle,
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

function contentStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 320px",
    gap: "16px",
    minHeight: 0,
  };
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
  gap: "14px",
  alignContent: "start",
};

function userCardStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "8px",
    justifyItems: "center",
    padding: "12px 10px",
    borderRadius: "var(--x-radius-md)",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line)",
    background: active ? "var(--x-color-accent-border)" : "var(--x-color-panel)",
    boxShadow: active ? "0 14px 30px var(--x-color-accent-border), inset 0 1px 0 var(--x-color-line)" : "inset 0 1px 0 var(--x-color-line)",
    backdropFilter: "blur(14px)",
    cursor: "pointer",
  };
}

function avatarStyle(checked: boolean): CSSProperties {
  return {
    width: "72px",
    height: "72px",
    borderRadius: "50%",
    objectFit: "cover",
    filter: checked ? "none" : "grayscale(1) brightness(0.88)",
    opacity: checked ? 1 : 0.75,
    border: checked ? "2px solid var(--x-color-success)" : "2px solid var(--x-color-accent-soft)",
  };
}

const userNameStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  textAlign: "center",
  lineHeight: 1.4,
};

const userMetaStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

const sideStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  alignContent: "start",
  padding: "16px",
  borderRadius: "var(--x-radius-md)",
  ...glassInsetStyle,
};

const sideHeaderStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
};

function sideAvatarStyle(checked: boolean): CSSProperties {
  return {
    width: "74px",
    height: "74px",
    borderRadius: "50%",
    objectFit: "cover",
    border: checked ? "2px solid var(--x-color-success)" : "2px solid var(--x-color-accent-soft)",
  };
}

const sideTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const sideMetaStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

const infoCardStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "14px",
  borderRadius: "var(--x-radius-md)",
  ...glassInsetStyle,
};

const infoRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
};

const infoLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const infoValueStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink)",
};

const actionStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-accent-border)",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-accent-soft))",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 14px 32px var(--x-color-accent-border)",
  backdropFilter: "blur(14px)",
};

const dangerButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
  backdropFilter: "blur(14px)",
};

const placeholderStyle: CSSProperties = {
  minHeight: "140px",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
  backdropFilter: "blur(14px)",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  ...glassButtonStyle,
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const mobileWrapStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "14px",
  ...glassContainerStyle,
};

const mobileHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const mobileEyebrowStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 800,
  color: "var(--x-color-accent)",
  textTransform: "uppercase",
  letterSpacing: 0,
};

const mobileTitleStyle: CSSProperties = {
  fontSize: "20px",
  lineHeight: 1.25,
  fontWeight: 850,
  color: "var(--x-color-ink)",
};

const mobileHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

const mobileUserPillStyle: CSSProperties = {
  maxWidth: "42vw",
  minHeight: "34px",
  padding: "7px 12px",
  borderRadius: "999px",
  ...glassButtonStyle,
  color: "var(--x-color-ink)",
  fontSize: "12px",
  fontWeight: 750,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};

const mobileTabStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "6px",
  padding: "4px",
  borderRadius: "var(--x-radius-md)",
  ...glassInsetStyle,
};

function mobileTabButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: "40px",
    borderRadius: "var(--x-radius-md)",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    background: active ? "var(--x-color-accent-border)" : "transparent",
    color: active ? "var(--x-color-accent)" : "var(--x-color-ink-muted)",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  };
}

const mobileSuccessStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-success-soft)",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
  fontSize: "13px",
  fontWeight: 750,
};

const scannerPanelStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const scannerFrameStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "1 / 1",
  overflow: "hidden",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-accent-soft)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 14px 32px var(--x-color-shadow-soft)",
};

const scannerVideoStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const scannerOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: "14%",
  border: "2px solid var(--x-color-panel)",
  borderRadius: "var(--x-radius-md)",
  boxShadow: "0 0 0 999px var(--x-color-accent-tint)",
  pointerEvents: "none",
};

const manualScanStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "8px",
  alignItems: "center",
};

const manualInputStyle: CSSProperties = {
  minWidth: 0,
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  ...glassButtonStyle,
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

const codePanelStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: "12px",
  textAlign: "center",
};

const qrBoxStyle: CSSProperties = {
  width: "min(100%, 300px)",
  aspectRatio: "1 / 1",
  display: "grid",
  placeItems: "center",
  padding: "12px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 14px 32px var(--x-color-shadow-soft)",
  backdropFilter: "blur(14px)",
  boxSizing: "border-box",
};

const qrImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
};
