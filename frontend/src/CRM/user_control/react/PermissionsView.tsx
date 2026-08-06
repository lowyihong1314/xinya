import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { DepartmentRecord, PermissionRecord, UserRecord } from "./types";

// 权限视角：同一份部门/权限/成员数据（与部门管理同一套 API），换个 UI——
// 以「权限」为主轴：选一个权限，看哪些部门授予它、哪些成员因此拥有它，并可增删。
export function PermissionsView({
  isMobile,
  permissions,
  departments,
  users,
  loading,
  selectedPermissionId,
  onSelectPermission,
  onRefresh,
  onSavePermissions,
}: {
  isMobile: boolean;
  permissions: PermissionRecord[];
  departments: DepartmentRecord[];
  users: UserRecord[];
  loading: boolean;
  selectedPermissionId: string | null;
  onSelectPermission: (id: string) => void;
  onRefresh: () => void;
  onSavePermissions: (departmentId: number, nextIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  // deptId -> 成员数（从 users 的 departments 反推）
  const membersByDept = useMemo(() => {
    const map = new Map<number, UserRecord[]>();
    for (const u of users) {
      for (const d of u.departments || []) {
        const arr = map.get(d.id) || [];
        arr.push(u);
        map.set(d.id, arr);
      }
    }
    return map;
  }, [users]);

  function deptsWithPermission(pid: string): DepartmentRecord[] {
    return departments.filter((d) => (d.permissions || []).some((p) => p.id === pid));
  }
  function usersWithPermission(pid: string): { user: UserRecord; via: string[] }[] {
    const out: { user: UserRecord; via: string[] }[] = [];
    for (const u of users) {
      const via = (u.departments || [])
        .filter((d) => (d.permissions || []).some((p) => p.id === pid))
        .map((d) => d.name);
      if (via.length) out.push({ user: u, via });
    }
    return out;
  }

  const filteredPerms = useMemo(() => {
    const kw = query.trim().toLowerCase();
    const list = kw
      ? permissions.filter((p) => `${p.name} ${p.ref || ""}`.toLowerCase().includes(kw))
      : permissions;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [permissions, query]);

  const selected = permissions.find((p) => p.id === selectedPermissionId) || null;

  function toggleDept(dept: DepartmentRecord, pid: string, has: boolean) {
    const currentIds = (dept.permissions || []).map((p) => p.id);
    const nextIds = has ? currentIds.filter((id) => id !== pid) : [...currentIds, pid];
    onSavePermissions(dept.id, nextIds);
  }

  const grantingUsers = selected ? usersWithPermission(selected.id) : [];

  return (
    <div style={wrapStyle(isMobile)}>
      {/* 左：权限列表 */}
      <div style={leftPaneStyle}>
        <div style={paneHeadStyle}>
          <span style={paneTitleStyle}>权限（{permissions.length}）</span>
          <button type="button" style={ghostBtnStyle} onClick={onRefresh} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
        </div>
        <input style={searchStyle} placeholder="搜索权限名称 / ref" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div style={permListStyle}>
          {!filteredPerms.length ? <div style={mutedStyle}>没有权限。</div> : null}
          {filteredPerms.map((p) => {
            const on = p.id === selectedPermissionId;
            const deptCount = deptsWithPermission(p.id).length;
            return (
              <button key={p.id} type="button" style={{ ...permItemStyle, ...(on ? permItemOnStyle : {}) }} onClick={() => onSelectPermission(p.id)}>
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  {p.ref ? <span style={refStyle}>{p.ref}</span> : null}
                </span>
                <span style={countPillStyle}>{deptCount} 部门</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右：选中权限的部门 + 成员 */}
      <div style={rightPaneStyle}>
        {!selected ? (
          <div style={emptyStyle}>← 选择一个权限，查看哪些部门授予它、哪些成员拥有它。</div>
        ) : (
          <>
            <div style={selHeadStyle}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{selected.name}</div>
              {selected.ref ? <div style={refStyle}>{selected.ref}</div> : null}
              <div style={mutedStyle}>{deptsWithPermission(selected.id).length} 个部门授予 · {grantingUsers.length} 位成员拥有</div>
            </div>

            {/* 部门在左、成员在右，两栏各自滚动，避免页面被拉长 */}
            <div style={detailColumnsStyle(isMobile)}>
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>部门（勾选=授予此权限）</div>
                <div style={scrollListStyle}>
                  {departments.map((d) => {
                    const has = (d.permissions || []).some((p) => p.id === selected.id);
                    const memberCount = (membersByDept.get(d.id) || []).length;
                    return (
                      <label key={d.id} style={{ ...deptRowStyle, ...(has ? deptRowOnStyle : {}) }}>
                        <input type="checkbox" checked={has} onChange={() => toggleDept(d, selected.id, has)} />
                        <span style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{d.name}</span>
                        <span style={countPillStyle}>{memberCount} 人</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>拥有此权限的成员（{grantingUsers.length}）</div>
                {!grantingUsers.length ? (
                  <div style={mutedStyle}>还没有成员拥有此权限（把权限授予某个有成员的部门即可）。</div>
                ) : (
                  <div style={scrollListStyle}>
                    {grantingUsers.map(({ user, via }) => (
                      <div key={user.id} style={memberRowStyle}>
                        <span style={{ fontWeight: 700, minWidth: 0 }}>{user.display_name || user.username || user.name_NRIC || `#${user.id}`}</span>
                        <span style={viaWrapStyle}>
                          {via.map((name) => <span key={name} style={viaChipStyle}>{name}</span>)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function wrapStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 320px) 1fr", gap: 12, alignItems: "start" };
}
const leftPaneStyle: CSSProperties = { display: "grid", gap: 8, padding: 12, borderRadius: 12, border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const rightPaneStyle: CSSProperties = { display: "grid", gap: 12, padding: 12, borderRadius: 12, border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", minWidth: 0 };
const paneHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const paneTitleStyle: CSSProperties = { fontWeight: 800, fontSize: 14 };
const searchStyle: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: 13 };
const permListStyle: CSSProperties = { display: "grid", gap: 4, maxHeight: "60vh", overflowY: "auto" };
const permItemStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", cursor: "pointer", fontSize: 13 };
const permItemOnStyle: CSSProperties = { border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-tint)" };
const refStyle: CSSProperties = { fontSize: 11.5, color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)" };
const countPillStyle: CSSProperties = { flexShrink: 0, padding: "2px 9px", borderRadius: 999, background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)", fontSize: 11.5, fontWeight: 700 };
const selHeadStyle: CSSProperties = { display: "grid", gap: 3, paddingBottom: 8, borderBottom: "1px solid var(--x-color-line-soft)" };
function detailColumnsStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 340px) 1fr", gap: 14, alignItems: "start" };
}
const scrollListStyle: CSSProperties = { display: "grid", gap: 6, maxHeight: "62vh", overflowY: "auto", paddingRight: 2 };
const sectionStyle: CSSProperties = { display: "grid", gap: 8 };
const sectionTitleStyle: CSSProperties = { fontWeight: 800, fontSize: 13 };
const deptRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", cursor: "pointer", fontSize: 13 };
const deptRowOnStyle: CSSProperties = { border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-tint)" };
const memberRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", fontSize: 13, flexWrap: "wrap" };
const viaWrapStyle: CSSProperties = { display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" };
const viaChipStyle: CSSProperties = { padding: "2px 8px", borderRadius: 999, background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", fontSize: 11, fontWeight: 700 };
const ghostBtnStyle: CSSProperties = { padding: "6px 10px", borderRadius: 7, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: 12, fontWeight: 700, cursor: "pointer" };
const mutedStyle: CSSProperties = { fontSize: 12.5, color: "var(--x-color-ink-muted)", padding: "6px 2px" };
const emptyStyle: CSSProperties = { padding: 28, borderRadius: 10, border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
