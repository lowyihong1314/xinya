/** 当前登录用户。字段名对齐后端 /user_control/get_user_data 的响应。 */
export interface CurrentUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  email_verified: boolean;
  department_id: number | null;
  department_name: string | null;
  [key: string]: unknown;
}

export interface SessionState {
  user: CurrentUser | null;
  /** 权限名集合。后端的权限清单是**代码里的常量**（backend/core/permissions.py），不是库里的行。 */
  permissions: ReadonlySet<string>;
  /** 首次拉取尚未完成。用它区分「还不知道」和「确定没登录」——两者的界面不一样。 */
  loading: boolean;
}
