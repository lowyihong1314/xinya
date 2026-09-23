/**
 * 用户与权限。后端 /user_control/* + /permission/*。
 * 列表接口实测过；带权限的接口形状来自后端 router.py。
 */

export interface UserBrief {
  id: number;
  username: string;
  display_name: string | null;
  [key: string]: unknown;
}

export interface UserListResponse {
  login: boolean;
  data: UserBrief[];
}

export interface DepartmentPermission {
  /** ★ 权限的标识**就是它的名字**（清单是后端代码里的常量，不是库里的行）。 */
  name: string;
  [key: string]: unknown;
}

export interface Department {
  id: number;
  name: string;
  permissions?: DepartmentPermission[];
  users?: UserBrief[];
  [key: string]: unknown;
}

/** 权限清单（全量可选项）。id / ref 都等于 name，是为了兼容旧前端的写法。 */
export interface PermissionCatalogEntry {
  id: string;
  name: string;
  ref: string;
  description: string;
}

export interface PermissionCatalogResponse {
  permissions: PermissionCatalogEntry[];
  count: number;
}
