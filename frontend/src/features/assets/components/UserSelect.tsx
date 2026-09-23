import { useApiQuery } from "@/shared/api/useApiQuery";
import { Select } from "@/shared/ui";
import { fetchUsers, userKeys } from "@/features/users/api";

/**
 * 选一个系统用户（仓库负责人、单据的经手人 / 领用人）。
 *
 * 用户列表从 users 模块的 api.ts 导入 —— 按「只有 api.ts 知道接口路径」的约定，
 * 不在资产这边重写一遍 "/user_control/get_all_user_data"。
 * 那条接口**没有权限门槛**（登录用户拿到的是 {id, username, display_name} 这一档），
 * 所以只有 asset_edit 的人也能正常用这个下拉，不会 403。
 *
 * ★ 空串 = 没选，对应后端的 null。**不要用 0 当空值** —— 后端 `_optional_int`
 *   只把 None / "" / "null" 当作没传，0 会被当成 user_id=0 拿去查，然后报「不存在」。
 *
 * ★ `fallbackLabel`：单据上存着的人可能不在列表里（用户被删、或未登录档位被过滤掉）。
 *   不补这一项的话原生 <select> 会显示成空白，用户以为没填，一保存就把人清掉了。
 */
export function UserSelect({
  id,
  value,
  onChange,
  placeholder = "不指定",
  fallbackLabel,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  /** 用户 id 的字符串形式，"" 表示没选。 */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 当前值不在列表里时显示的名字（通常是后端给的 *_name 字段）。 */
  fallbackLabel?: string | null;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const users = useApiQuery(userKeys.list(), fetchUsers);
  const list = users.data?.data ?? [];
  const missing = value && !list.some((u) => String(u.id) === value);

  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {missing ? <option value={value}>{fallbackLabel || `用户 #${value}`}</option> : null}
      {list.map((user) => (
        <option key={user.id} value={String(user.id)}>
          {user.display_name || user.username}
        </option>
      ))}
    </Select>
  );
}
