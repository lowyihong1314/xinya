/** 当前登录用户。字段对齐后端 GET /user_control/get_user_data（= User.to_dict()）。 */

export interface DepartmentPermission {
  name: string;
  [key: string]: unknown;
}

export interface Department {
  id: number;
  name: string;
  /** ★ 权限挂在部门下，**没有**顶层 permissions 键。见 SessionState.permissions 的说明。 */
  permissions?: DepartmentPermission[];
  [key: string]: unknown;
}

export interface CurrentUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  email_verified?: boolean;
  departments?: Department[];
  [key: string]: unknown;
}

export interface SessionState {
  user: CurrentUser | null;
  /**
   * 权限名集合。
   *
   * ★ 后端**不返回**顶层 permissions —— 要自己从 `departments[].permissions[].name`
   *   摊平（与后端 core/auth.py 的 get_current_user_permissions 同一套口径）。
   *   读顶层的话永远是空集，表现是**所有带权限的菜单和按钮都不显示**，
   *   而且当事人会以为是没给他开权限。
   *
   * 权限清单本身是后端**代码里的常量**（backend/core/permissions.py），不是库里的行。
   */
  permissions: ReadonlySet<string>;
  /** 首次拉取尚未完成。用它区分「还不知道」和「确定没登录」——两者界面不一样。 */
  loading: boolean;
}
