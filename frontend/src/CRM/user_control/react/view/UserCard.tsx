import { CachedImage } from "../../../../components/CachedMedia";
import { API_BASE } from "../../../../js/apiBase";
import type { UserRecord } from "../types";
import * as styles from "./styles";

export function UserCard({
  user,
  actionLabel,
  actionTone,
  onOpen,
  onAction,
  showDepartments,
}: {
  user: UserRecord;
  actionLabel?: string;
  actionTone?: "default" | "danger";
  onOpen?: () => void;
  onAction?: () => void;
  showDepartments?: boolean;
}) {
  const departments = showDepartments ? user.departments || [] : [];
  const body = (
    <>
      <CachedImage
        src={`${API_BASE}/api/user_control/get_profile_image/${user.id}`}
        cacheKey={`user-control-avatar:${user.id}`}
        alt={user.display_name || user.username || String(user.id)}
        style={styles.avatarStyle}
      />
      <div style={styles.userInfoStyle}>
        <div style={styles.userNameRowStyle}>
          <span style={styles.userNameStyle}>
            {user.display_name || user.username || `#${user.id}`}
          </span>
          <span style={styles.memberBadgeStyle(Boolean(user.is_member))}>
            {user.is_member ? "会员" : "非会员"}
          </span>
          {user.xin_ya ? <span style={styles.xinYaBadgeStyle}>心芽</span> : null}
        </div>
        <div style={styles.userMetaStyle}>{user.email || user.phone || "-"}</div>
        {departments.length ? (
          <div style={styles.departmentChipsStyle}>
            {departments.map((department) => (
              <span key={department.id} style={styles.departmentChipStyle}>
                {department.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div style={styles.userCardStyle}>
      {onOpen ? (
        <button type="button" style={styles.userOpenStyle} onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div style={styles.readOnlyUserCardBodyStyle}>{body}</div>
      )}
      {actionLabel && onAction ? (
        <button
          type="button"
          style={styles.actionButtonStyle(actionTone === "danger")}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
