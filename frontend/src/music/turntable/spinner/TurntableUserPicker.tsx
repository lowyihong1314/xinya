import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { CachedImage } from "../../../components/CachedMedia";
import { apiFetch } from "../../../js/apiFetch";
import { displayUserName } from "./turntableRandom";
import type { SlotUser } from "./types";

type UserResponse = {
  data?: SlotUser[];
  error?: string;
  message?: string;
};

export function TurntableUserPicker({
  selectedUsers,
  onChange,
  poolLabel,
}: {
  selectedUsers: SlotUser[];
  onChange: (users: SlotUser[]) => void;
  poolLabel?: string;
}) {
  const [users, setUsers] = useState<SlotUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedIdSet = useMemo(() => new Set(selectedUsers.map((user) => user.id)), [selectedUsers]);

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      setLoading(true);
      setError("");
      try {
        const response = await apiFetch("/api/user_control/get_all_user_data", {
          credentials: "include",
        });
        const payload = (await response.json().catch(() => ({}))) as UserResponse;
        if (!response.ok) {
          throw new Error(payload.error || payload.message || "读取用户失败");
        }
        if (active) {
          setUsers(Array.isArray(payload.data) ? payload.data : []);
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
    }

    void loadUsers();
    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const sorted = [...users].sort((left, right) => displayUserName(left).localeCompare(displayUserName(right)));
    if (!keyword) {
      return sorted;
    }
    return sorted.filter((user) =>
      [user.display_name, user.username, user.id].some((value) => String(value ?? "").toLowerCase().includes(keyword)),
    );
  }, [query, users]);

  function toggleUser(user: SlotUser) {
    if (selectedIdSet.has(user.id)) {
      onChange(selectedUsers.filter((item) => item.id !== user.id));
      return;
    }
    onChange([...selectedUsers, user]);
  }

  function addVisibleUsers() {
    const next = [...selectedUsers];
    const known = new Set(next.map((user) => user.id));
    filteredUsers.forEach((user) => {
      if (!known.has(user.id)) {
        known.add(user.id);
        next.push(user);
      }
    });
    onChange(next);
  }

  return (
    <section style={pickerStyle}>
      <div style={toolbarStyle}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索姓名 / 用户名"
          style={searchStyle}
        />
        <button type="button" onClick={addVisibleUsers} style={smallButtonStyle}>
          全选当前
        </button>
        <button type="button" onClick={() => onChange([])} style={smallButtonStyle}>
          清空
        </button>
      </div>

      <div style={metaStyle}>
        已选 {selectedUsers.length} 人 / 可见 {filteredUsers.length} 人
      </div>
      {error ? <div style={stateStyle}>{error}</div> : null}

      <div style={layoutStyle}>
        <div style={gridStyle}>
          {loading ? <div style={stateStyle}>读取用户中...</div> : null}
          {!loading && !error && !filteredUsers.length ? <div style={stateStyle}>没有匹配的用户</div> : null}
          {!loading && !error
            ? filteredUsers.map((user) => {
                const selected = selectedIdSet.has(user.id);
                return (
                  <button key={user.id} type="button" onClick={() => toggleUser(user)} style={userCardStyle(selected)}>
                    <CachedImage
                      src={`/api/user_control/get_profile_image/${user.id}`}
                      cacheKey={`turntable-user:${user.id}`}
                      resolveRelativeToApi
                      alt=""
                      style={avatarStyle(selected)}
                    />
                    <span style={nameStyle}>{displayUserName(user)}</span>
                    <span style={usernameStyle}>{user.username || "-"}</span>
                  </button>
                );
              })
            : null}
        </div>

        <aside style={selectedPanelStyle}>
          <div style={selectedTitleStyle}>{poolLabel || "候选池"}</div>
          <div style={selectedListStyle}>
            {selectedUsers.length ? null : <div style={stateStyle}>尚未选择用户</div>}
            {selectedUsers.map((user) => (
              <button key={user.id} type="button" onClick={() => toggleUser(user)} style={selectedUserStyle}>
                <span>{displayUserName(user)}</span>
                <i className="fas fa-xmark" aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

const pickerStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const toolbarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  gap: "8px",
};

const searchStyle: CSSProperties = {
  minHeight: "42px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 12px",
  fontSize: "15px",
};

const smallButtonStyle: CSSProperties = {
  minHeight: "42px",
  padding: "0 12px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 800,
};

const layoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 280px)",
  gap: "12px",
  alignItems: "start",
};

const gridStyle: CSSProperties = {
  maxHeight: "460px",
  overflowY: "auto",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
  gap: "10px",
  paddingRight: "4px",
};

const userCardStyle = (selected: boolean): CSSProperties => ({
  minHeight: "132px",
  display: "grid",
  justifyItems: "center",
  alignContent: "center",
  gap: "7px",
  padding: "10px",
  border: selected ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: selected ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
});

const avatarStyle = (selected: boolean): CSSProperties => ({
  width: "48px",
  height: "48px",
  borderRadius: "999px",
  objectFit: "cover",
  border: selected ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
});

const nameStyle: CSSProperties = {
  fontWeight: 900,
  textAlign: "center",
  overflowWrap: "anywhere",
};

const usernameStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  overflowWrap: "anywhere",
};

const selectedPanelStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  padding: "12px",
  display: "grid",
  gap: "10px",
};

const selectedTitleStyle: CSSProperties = {
  fontWeight: 900,
};

const selectedListStyle: CSSProperties = {
  maxHeight: "408px",
  overflowY: "auto",
  display: "grid",
  gap: "7px",
};

const selectedUserStyle: CSSProperties = {
  minHeight: "36px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  padding: "0 10px",
  cursor: "pointer",
};

const stateStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
  padding: "12px",
};
