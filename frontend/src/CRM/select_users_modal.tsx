import { useEffect, useMemo, useState } from "react";

import { openOverlay } from "../app/OverlayProvider";
import { CachedImage } from "../components/CachedMedia";
import { apiFetch } from "../js/apiFetch";

export type UserRecord = {
  id: number;
  username?: string | null;
  display_name?: string | null;
};

type UserResponse = {
  data?: UserRecord[];
  message?: string;
  error?: string;
};

type SelectUsersDialogProps = {
  maxId: number;
  onClose: (selectedIds: number[]) => void;
};

async function fetchUsers() {
  const response = await apiFetch("/api/user_control/get_all_user_data", {
    credentials: "include",
  });
  const payload = (await response.json().catch(() => ({}))) as UserResponse;

  if (!response.ok) {
    throw new Error(payload.error || payload.message || "读取用户失败");
  }

  return payload.data || [];
}

function SelectUsersDialog({ maxId, onClose }: SelectUsersDialogProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectionError, setSelectionError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const nextUsers = await fetchUsers();
        if (active) {
          setUsers(nextUsers);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "读取用户失败");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return users;
    }

    return users.filter((user) => {
      const displayName = (user.display_name || "").toLowerCase();
      const username = (user.username || "").toLowerCase();
      return displayName.includes(keyword) || username.includes(keyword);
    });
  }, [query, users]);

  function toggleUser(userId: number) {
    setSelectedIds((current) => {
      if (current.includes(userId)) {
        if (selectionError) {
          setSelectionError("");
        }
        return current.filter((id) => id !== userId);
      }

      if (current.length >= maxId) {
        setSelectionError(`最多只能选择 ${maxId} 人`);
        return current;
      }

      if (selectionError) {
        setSelectionError("");
      }
      return [...current, userId];
    });
  }

  return (
    <div style={overlayStyle} onClick={() => onClose([])}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Organizer Picker</div>
            <div style={titleStyle}>{`选择用户（最多 ${maxId} 人）`}</div>
          </div>
          <button type="button" style={closeIconStyle} onClick={() => onClose([])}>
            关闭
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名 / 用户名"
          style={searchInputStyle}
        />

        <div style={metaStyle}>{`已选 ${selectedIds.length} 人 / 可见 ${filteredUsers.length} 人`}</div>
        {selectionError ? <div style={stateStyle}>{selectionError}</div> : null}

        <div style={listStyle}>
          {loading ? <div style={stateStyle}>加载中…</div> : null}
          {!loading && error ? <div style={stateStyle}>{error}</div> : null}
          {!loading && !error && !filteredUsers.length ? <div style={stateStyle}>没有匹配的用户</div> : null}

          {!loading && !error
            ? filteredUsers.map((user) => {
                const selected = selectedIds.includes(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    style={cardStyle(selected)}
                    onClick={() => toggleUser(user.id)}
                  >
                    <CachedImage
                      src={`/api/user_control/get_profile_image/${user.id}`}
                      cacheKey={`select-users-avatar:${user.id}`}
                      resolveRelativeToApi
                      alt=""
                      style={avatarStyle}
                    />
                    <div style={nameStyle}>{user.display_name || user.username || ""}</div>
                    <div style={usernameStyle}>{user.username || "-"}</div>
                  </button>
                );
              })
            : null}
        </div>

        <div style={footerStyle}>
          <button type="button" style={cancelButtonStyle} onClick={() => onClose([])}>
            取消
          </button>
          <button type="button" style={confirmButtonStyle} onClick={() => onClose(selectedIds)}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

type SelectCounterpartyDialogProps = {
  title?: string;
  onClose: (selectedUser: UserRecord | null) => void;
};

function SelectCounterpartyDialog({
  title,
  onClose,
}: SelectCounterpartyDialogProps) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const nextUsers = await fetchUsers();
        if (!active) {
          return;
        }
        setUsers(nextUsers);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "读取用户失败");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return users.filter((user) => {
      if (!keyword) {
        return true;
      }
      return [
        user.display_name,
        user.username,
      ]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(keyword));
    });
  }, [query, users]);

  const selectedUser =
    filteredUsers.find((user) => user.id === selectedId) ||
    users.find((user) => user.id === selectedId) ||
    null;

  return (
    <div style={overlayStyle} onClick={() => onClose(null)}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Counterparty Picker</div>
            <div style={titleStyle}>{title || "选择往来对象"}</div>
          </div>
          <button type="button" style={closeIconStyle} onClick={() => onClose(null)}>
            关闭
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名 / 用户名"
          style={searchInputStyle}
        />

        <div style={metaStyle}>
          {selectedUser
            ? `已选 ${selectedUser.display_name || selectedUser.username || ""}`
            : `可见 ${filteredUsers.length} 个用户`}
        </div>

        <div style={listStyle}>
          {loading ? <div style={stateStyle}>加载中…</div> : null}
          {!loading && error ? <div style={stateStyle}>{error}</div> : null}
          {!loading && !error && !filteredUsers.length ? <div style={stateStyle}>没有匹配的用户</div> : null}

          {!loading && !error
            ? filteredUsers.map((user) => {
                const selected = user.id === selectedId;
                return (
                  <button
                    key={user.id}
                    type="button"
                    style={cardStyle(selected)}
                    onClick={() => setSelectedId(user.id)}
                  >
                    <CachedImage
                      src={`/api/user_control/get_profile_image/${user.id}`}
                      cacheKey={`select-counterparty-avatar:${user.id}`}
                      resolveRelativeToApi
                      alt=""
                      style={avatarStyle}
                    />
                    <div style={nameStyle}>{user.display_name || user.username || ""}</div>
                    <div style={usernameStyle}>{user.username || "-"}</div>
                  </button>
                );
              })
            : null}
        </div>

        <div style={footerStyle}>
          <button type="button" style={cancelButtonStyle} onClick={() => onClose(null)}>
            取消
          </button>
          <button
            type="button"
            style={confirmButtonStyle}
            disabled={!selectedUser}
            onClick={() => onClose(selectedUser)}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function select_users_modal(maxId = Infinity) {
  return new Promise<number[]>((resolve) => {
    openOverlay((close) => (
      <SelectUsersDialog
        maxId={maxId}
        onClose={(selectedIds) => {
          close();
          resolve(selectedIds);
        }}
      />
    ));
  });
}

export function select_counterparty_modal(options?: {
  title?: string;
}) {
  return new Promise<UserRecord | null>((resolve) => {
    openOverlay((close) => (
      <SelectCounterpartyDialog
        title={options?.title}
        onClose={(selectedUser) => {
          close();
          resolve(selectedUser);
        }}
      />
    ));
  });
}

export function select_single_user_modal(options?: {
  title?: string;
}) {
  return select_counterparty_modal(options);
}

const overlayStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "rgba(31, 24, 15, 0.52)",
};

const modalStyle = {
  width: "min(780px, 100%)",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column" as const,
  gap: "12px",
  padding: "20px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, #fffdf8, #f8f2e7)",
  boxShadow: "0 24px 60px rgba(0,0,0,0.24)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "flex-start",
};

const eyebrowStyle = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "#8a6a3b",
  marginBottom: "6px",
};

const titleStyle = {
  fontSize: "20px",
  fontWeight: 900,
  color: "#3d2f19",
};

const closeIconStyle = {
  border: "none",
  background: "transparent",
  color: "#8a6a3b",
  cursor: "pointer",
  fontWeight: 700,
};

const searchInputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(138, 106, 59, 0.2)",
  background: "rgba(255,255,255,0.9)",
  boxSizing: "border-box" as const,
};

const metaStyle = {
  fontSize: "13px",
  color: "#7a6241",
};

const listStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
  gap: "12px",
  overflowY: "auto" as const,
  padding: "4px",
};

const stateStyle = {
  gridColumn: "1 / -1",
  padding: "32px 16px",
  textAlign: "center" as const,
  color: "#7a6241",
};

const cardStyle = (selected: boolean) => ({
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  gap: "8px",
  padding: "12px 10px",
  borderRadius: "16px",
  border: selected ? "1px solid rgba(114, 80, 34, 0.4)" : "1px solid rgba(0,0,0,0.08)",
  background: selected
    ? "linear-gradient(135deg, #7c5b2b, #b88b4d)"
    : "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(247,242,232,0.94))",
  color: selected ? "#fffaf0" : "#362915",
  cursor: "pointer",
  boxShadow: selected ? "0 14px 30px rgba(124, 91, 43, 0.26)" : "0 8px 18px rgba(0,0,0,0.06)",
});

const avatarStyle = {
  width: "54px",
  height: "54px",
  borderRadius: "50%",
  objectFit: "cover" as const,
  background: "#ece3d1",
};

const nameStyle = {
  fontSize: "13px",
  fontWeight: 800,
  textAlign: "center" as const,
  lineHeight: 1.4,
};

const usernameStyle = {
  fontSize: "12px",
  opacity: 0.78,
};

const footerStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
};

const cancelButtonStyle = {
  padding: "10px 16px",
  borderRadius: "12px",
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
};

const confirmButtonStyle = {
  padding: "10px 16px",
  borderRadius: "12px",
  border: "none",
  background: "linear-gradient(135deg, #7c5b2b, #b88b4d)",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};
