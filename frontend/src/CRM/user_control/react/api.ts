import type { DepartmentRecord, DepartmentUsersResponse, MemberRenewalRecord, PermissionRecord, UserRecord } from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    success?: boolean;
  };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

export async function fetchDepartments() {
  const response = await fetch("/api/user_control/departments", { credentials: "include" });
  return parseJson<DepartmentRecord[]>(response);
}

export async function fetchDepartmentUsers(departmentId: number) {
  const response = await fetch(`/api/user_control/departments/${departmentId}/users`, {
    credentials: "include",
  });
  return parseJson<DepartmentUsersResponse>(response);
}

export async function fetchAllUsers() {
  const response = await fetch("/api/user_control/get_all_user_data", { credentials: "include" });
  return parseJson<{ login?: boolean; data?: UserRecord[] }>(response);
}

export async function fetchUserDetail(userId: number) {
  const response = await fetch(`/api/user_control/get_user_detail/${userId}`, {
    credentials: "include",
  });
  return parseJson<UserRecord>(response);
}

export async function registerUser(payload: {
  username: string;
  email: string;
  phone?: string;
  password: string;
}) {
  const response = await fetch("/api/user_control/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; user?: UserRecord; message?: string }>(response);
}

export async function createDepartment(name: string) {
  const response = await fetch("/api/user_control/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  return parseJson<{ status?: string; id?: number; message?: string }>(response);
}

export async function deleteDepartment(departmentId: number) {
  const response = await fetch(`/api/user_control/departments/${departmentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function addUserToDepartment(departmentId: number, userId: number) {
  const response = await fetch(`/api/user_control/departments/${departmentId}/add_user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ user_id: userId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function removeUserFromDepartment(departmentId: number, userId: number) {
  const response = await fetch(`/api/user_control/departments/${departmentId}/remove_user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ user_id: userId }),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function fetchAllPermissions() {
  const response = await fetch("/api/permission/get_all_permission", { credentials: "include" });
  return parseJson<{ permissions?: PermissionRecord[] }>(response);
}

export async function addPermissionToDepartment(departmentId: number, permissionId: number) {
  const response = await fetch("/api/permission/add_permission_to_department", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ department_id: departmentId, permission_id: permissionId }),
  });
  return parseJson<{ message?: string }>(response);
}

export async function removePermissionFromDepartment(departmentId: number, permissionId: number) {
  const response = await fetch("/api/permission/remove_permission_from_department", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ department_id: departmentId, permission_id: permissionId }),
  });
  return parseJson<{ message?: string }>(response);
}

export async function editUserData(payload: Record<string, unknown>) {
  const response = await fetch("/api/user_control/edit_user_data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function deleteUser(userId: number) {
  const response = await fetch(`/api/user_control/delete_user/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function createMemberRenewal(userId: number, payload: { renewal_date: string; note?: string; proof?: File | null }) {
  const formData = new FormData();
  formData.append("renewal_date", payload.renewal_date);
  if (payload.note) {
    formData.append("note", payload.note);
  }
  if (payload.proof) {
    formData.append("proof", payload.proof);
  }

  const response = await fetch(`/api/user_control/member_renewal/${userId}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return parseJson<{ status?: string; message?: string; data?: MemberRenewalRecord }>(response);
}

export async function deleteMemberRenewal(renewalId: number) {
  const response = await fetch(`/api/user_control/member_renewal/${renewalId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}

export async function resetUserPassword(userId: number) {
  const response = await fetch(`/api/user_control/reset_password/${userId}`, {
    credentials: "include",
  });
  return parseJson<{ status?: string; message?: string }>(response);
}
