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
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

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

  const selectedUser =
    users.find((user) => user.id === selectedUserId) ||
    filteredUsers[0] ||
    null;

  useEffect(() => {
    if (!selectedUser && selectedUserId !== null) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId && filteredUsers[0]) {
      setSelectedUserId(filteredUsers[0].id);
    }
  }, [filteredUsers, selectedUser, selectedUserId]);

  const selectedCheckIn = selectedUser ? checkInMap.get(selectedUser.id) || null : null;

  async function handleCheckIn() {
    if (!selectedUser) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveEventCheckIn({
        event_id: detail.id,
        user_id: selectedUser.id,
        check_in_date: selectedDate,
        valid_user_id: currentUserId,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "签到失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRollback() {
    if (!selectedCheckIn?.id) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteEventCheckIn(selectedCheckIn.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回签到失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="event-checkin" style={wrapStyle(isMobile)}>
      <div className="event-checkin__toolbar" style={toolbarStyle(isMobile)}>
        <input
          className="event-checkin__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索成员"
          style={searchStyle}
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

      {error ? <div className="event-checkin__error" style={errorStyle}>{error}</div> : null}

      <div className="event-checkin__content" style={contentStyle(isMobile)}>
        <div className="event-checkin__grid" style={gridStyle}>
          {loadingUsers ? <div style={placeholderStyle}>读取成员中…</div> : null}
          {!loadingUsers &&
            filteredUsers.map((user) => {
              const checkIn = checkInMap.get(user.id) || null;
              const checked = Boolean(checkIn);
              const active = selectedUser?.id === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  className="event-checkin__user-card"
                  style={userCardStyle(active)}
                  onClick={() => setSelectedUserId(user.id)}
                >
                  <CachedImage
                    src={`/api/user_control/get_profile_image/${user.id}`}
                    cacheKey={`event-checkin-user:${user.id}`}
                    resolveRelativeToApi
                    alt=""
                    style={avatarStyle(checked)}
                  />
                  <div style={userNameStyle}>{user.display_name || user.username || `用户 ${user.id}`}</div>
                  <div style={userMetaStyle}>{checked ? checkInHelperLabel(checkIn) : "未签到"}</div>
                </button>
              );
            })}
        </div>

        <div className="event-checkin__side" style={sideStyle}>
          {selectedUser ? (
            <>
              <div style={sideHeaderStyle}>
                <CachedImage
                  src={`/api/user_control/get_profile_image/${selectedUser.id}`}
                  cacheKey={`event-checkin-selected-user:${selectedUser.id}`}
                  resolveRelativeToApi
                  alt=""
                  style={sideAvatarStyle(Boolean(selectedCheckIn))}
                />
                <div>
                  <div style={sideTitleStyle}>{selectedUser.display_name || selectedUser.username || `用户 ${selectedUser.id}`}</div>
                  <div style={sideMetaStyle}>
                    {selectedCheckIn
                      ? `已于 ${formatDateTime(selectedCheckIn.check_in_time)} 签到 · ${checkInHelperLabel(selectedCheckIn)}`
                      : `${selectedDate} 尚未签到`}
                  </div>
                </div>
              </div>

              <div style={infoCardStyle}>
                <div style={infoRowStyle}>
                  <span style={infoLabelStyle}>签到日期</span>
                  <span style={infoValueStyle}>{selectedDate}</span>
                </div>
                <div style={infoRowStyle}>
                  <span style={infoLabelStyle}>状态</span>
                  <span style={infoValueStyle}>{selectedCheckIn ? "已签到" : "未签到"}</span>
                </div>
                {selectedCheckIn ? (
                  <div style={infoRowStyle}>
                    <span style={infoLabelStyle}>帮签人</span>
                    <span style={infoValueStyle}>{selectedCheckIn.valid_user_name || "-"}</span>
                  </div>
                ) : null}
              </div>

              <div style={actionStyle}>
                {!selectedCheckIn ? (
                  <button type="button" style={primaryButtonStyle} onClick={() => void handleCheckIn()} disabled={saving}>
                    {saving ? "签到中…" : "帮他签到"}
                  </button>
                ) : (
                  <button type="button" style={dangerButtonStyle} onClick={() => void handleRollback()} disabled={saving}>
                    {saving ? "处理中…" : "撤回签到"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div style={placeholderStyle}>请选择一个成员</div>
          )}
        </div>
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
      <section style={mobileWrapStyle}>
        <div style={mobileTitleStyle}>活动签到</div>
        <div style={mobileHintStyle}>请先登录，再使用手机扫码签到。</div>
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
    <section style={mobileWrapStyle}>
      <div style={mobileHeaderStyle}>
        <div>
          <div style={mobileEyebrowStyle}>Check-in</div>
          <div style={mobileTitleStyle}>活动签到</div>
        </div>
        <div style={mobileUserPillStyle}>{currentUserName}</div>
      </div>

      <div style={mobileTabStyle}>
        <button type="button" style={mobileTabButtonStyle(activeTab === "scan")} onClick={() => setActiveTab("scan")}>
          我要签到
        </button>
        <button type="button" style={mobileTabButtonStyle(activeTab === "code")} onClick={() => setActiveTab("code")}>
          和我签到
        </button>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}
      {message ? <div style={mobileSuccessStyle}>{message}</div> : null}

      {activeTab === "scan" ? (
        <div style={scannerPanelStyle}>
          <div style={scannerFrameStyle}>
            <video ref={videoRef} muted playsInline style={scannerVideoStyle} />
            <div style={scannerOverlayStyle} />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>
          <div style={mobileHintStyle}>{busy ? "处理中…" : statusText}</div>
          <div style={manualScanStyle}>
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
        <div style={codePanelStyle}>
          <div style={qrBoxStyle}>
            {qrDataUrl ? <CachedImage src={qrDataUrl} alt="临时签到 QR" style={qrImageStyle} /> : <div style={placeholderStyle}>生成 QR 中…</div>}
          </div>
          <div style={mobileHintStyle}>
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

function wrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "16px",
    padding: isMobile ? "18px" : "20px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
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
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

const dateStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
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
    borderRadius: "18px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: active ? "var(--x-color-accent-tint)" : "var(--x-color-panel)",
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
    border: checked ? "2px solid var(--x-color-success)" : "2px solid var(--x-color-line-soft)",
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
  borderRadius: "18px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
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
    border: checked ? "2px solid var(--x-color-success)" : "2px solid var(--x-color-line-soft)",
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
  borderRadius: "16px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
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
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-tint)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

const placeholderStyle: CSSProperties = {
  minHeight: "140px",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-tint)",
  color: "var(--x-color-danger)",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const mobileWrapStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "14px",
  borderRadius: "18px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 14px 30px var(--x-color-shadow-soft)",
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
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
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
  borderRadius: "14px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
};

function mobileTabButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: "40px",
    borderRadius: "10px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    background: active ? "var(--x-color-accent-tint)" : "transparent",
    color: active ? "var(--x-color-accent)" : "var(--x-color-ink-muted)",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  };
}

const mobileSuccessStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-success-border)",
  background: "var(--x-color-success-tint)",
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
  borderRadius: "18px",
  background: "#111827",
  border: "1px solid var(--x-color-line-soft)",
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
  border: "2px solid rgba(255, 255, 255, 0.88)",
  borderRadius: "16px",
  boxShadow: "0 0 0 999px rgba(0, 0, 0, 0.28)",
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
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
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
  borderRadius: "18px",
  background: "#ffffff",
  border: "1px solid var(--x-color-line-soft)",
  boxSizing: "border-box",
};

const qrImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
};
