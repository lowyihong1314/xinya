import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { CachedImage } from "../../components/CachedMedia";
import { saveEventCheckIn, deleteEventCheckIn } from "../../event/shared/api";
import type { EventCheckInRecord, EventDetailRecord } from "../../event/shared/types";
import { apiFetch } from "../../js/apiFetch";

type UserRecord = {
  id: number;
  username?: string;
  display_name?: string;
};

export function EventCheckInPanel({
  detail,
  isMobile,
  onChanged,
}: {
  detail: EventDetailRecord;
  isMobile: boolean;
  onChanged: () => Promise<void> | void;
}) {
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
              const checked = checkInMap.has(user.id);
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
                  <div style={userMetaStyle}>{checked ? "已签到" : "未签到"}</div>
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
                      ? `已于 ${formatDateTime(selectedCheckIn.check_in_time)} 签到`
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
