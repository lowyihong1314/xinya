/**
 * 用户、部门、权限分配。
 * 后端 backend/api/user_control/router.py + backend/api/permission_mgmt/router.py。
 *
 * ⚠️ 权限清单是后端**代码里的常量**（backend/core/permissions.py），
 *    DB 只存「部门 ↔ 权限名」的分配关系。所以「有哪些权限可选」要调
 *    /permission/get_all_permission，不能从某个部门已有的权限里推。
 */
import { http } from "@/shared/api/client";

import type {
  Department,
  PermissionCatalogResponse,
  UserBrief,
  UserListResponse,
} from "./types";

export const userKeys = {
  all: ["users"] as const,
  list: () => [...userKeys.all, "list"] as const,
  departments: () => [...userKeys.all, "departments"] as const,
  catalog: () => [...userKeys.all, "permission-catalog"] as const,
  departmentUsers: (id: number) => [...userKeys.all, "department-users", id] as const,
};

export const fetchUsers = () => http.get<UserListResponse>("/user_control/get_all_user_data");

export const fetchDepartments = () => http.get<Department[]>("/user_control/departments");

export const fetchPermissionCatalog = () =>
  http.get<PermissionCatalogResponse>("/permission/get_all_permission");

export const fetchDepartmentUsers = (deptId: number) =>
  http.get<UserBrief[]>(`/user_control/departments/${deptId}/users`);

/**
 * 给部门加权限。
 * ⚠️ 幂等：已经有了会回 200「Permission already assigned」，新增成功是 **201**。
 *    两个码前端分得出来，别合并处理。
 */
export const addPermission = (departmentId: number, permissionName: string) =>
  http.post("/permission/add_permission_to_department", {
    department_id: departmentId,
    permission_name: permissionName,
  });

/**
 * 从部门移除权限。
 * ★ 后端这一侧**故意不校验权限名在不在清单里**（与新增那侧不对称）：
 *   某个权限从代码清单里删掉后，DB 里那条分配关系还在，卡清单就再也删不掉了。
 */
export const removePermission = (departmentId: number, permissionName: string) =>
  http.post("/permission/remove_permission_from_department", {
    department_id: departmentId,
    permission_name: permissionName,
  });

export const addUserToDepartment = (deptId: number, userId: number) =>
  http.post(`/user_control/departments/${deptId}/add_user`, { user_id: userId });

export const removeUserFromDepartment = (deptId: number, userId: number) =>
  http.post(`/user_control/departments/${deptId}/remove_user`, { user_id: userId });
