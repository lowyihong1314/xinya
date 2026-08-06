import { useEffect, useMemo, useState } from "react";

import {
  addPermissionToDepartment,
  addUserToDepartment,
  createDepartment,
  createMemberRenewal,
  deleteDepartment,
  deleteMemberRenewal,
  deleteUser,
  editUserData,
  fetchAllPermissions,
  fetchAllUsers,
  fetchDepartmentUsers,
  fetchDepartments,
  fetchUserDetail,
  registerUser,
  renameDepartment,
  removePermissionFromDepartment,
  removeUserFromDepartment,
  resetUserPassword,
} from "./api";
import type { DepartmentRecord, PermissionRecord, UserRecord } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;

export function useUserControlController() {
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [departmentUsers, setDepartmentUsers] = useState<UserRecord[]>([]);
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [allPermissions, setAllPermissions] = useState<PermissionRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  const [userEditorOpen, setUserEditorOpen] = useState(false);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedDepartmentId) {
      setDepartmentUsers([]);
      return;
    }
    void loadDepartmentUsers(selectedDepartmentId);
  }, [selectedDepartmentId]);

  const selectedDepartment = useMemo(
    () => departments.find((item) => item.id === selectedDepartmentId) ?? null,
    [departments, selectedDepartmentId],
  );

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return allUsers;
    }
    return allUsers.filter((user) => {
      const haystack = [
        user.display_name,
        user.username,
        user.email,
        user.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [allUsers, search]);

  async function loadInitial() {
    setLoading(true);
    try {
      const [departmentData, usersData, permissionData] = await Promise.all([
        fetchDepartments(),
        fetchAllUsers(),
        fetchAllPermissions(),
      ]);
      setDepartments(departmentData);
      setSelectedDepartmentId((prev) => prev ?? departmentData[0]?.id ?? null);
      setAllUsers(usersData.data || []);
      setAllPermissions(permissionData.permissions || []);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取用户管理数据失败" });
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartmentUsers(departmentId: number) {
    try {
      const payload = await fetchDepartmentUsers(departmentId);
      setDepartmentUsers(payload.users || []);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取部门成员失败" });
    }
  }

  async function openUserEditor(userId: number) {
    try {
      const detail = await fetchUserDetail(userId);
      setSelectedUser(detail);
      setUserEditorOpen(true);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取用户详情失败" });
    }
  }

  async function saveUser(payload: Record<string, unknown>) {
    if (!selectedUser) return;
    try {
      await editUserData({ user_id: selectedUser.id, ...payload });
      setToast({ type: "success", text: "用户信息已更新" });
      setUserEditorOpen(false);
      await loadInitial();
      if (selectedDepartmentId) {
        await loadDepartmentUsers(selectedDepartmentId);
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "保存用户失败" });
    }
  }

  async function removeUser(userId: number) {
    try {
      await deleteUser(userId);
      setToast({ type: "success", text: "用户已删除" });
      setUserEditorOpen(false);
      await loadInitial();
      if (selectedDepartmentId) {
        await loadDepartmentUsers(selectedDepartmentId);
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除用户失败" });
    }
  }

  async function doResetPassword(userId: number) {
    try {
      const result = await resetUserPassword(userId);
      setToast({ type: "success", text: result.message || "密码已重置" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "重置密码失败" });
    }
  }

  async function addRenewal(payload: { renewal_date: string; note?: string; proof?: File | null }) {
    if (!selectedUser) return;
    try {
      await createMemberRenewal(selectedUser.id, payload);
      const detail = await fetchUserDetail(selectedUser.id);
      setSelectedUser(detail);
      setToast({ type: "success", text: "续费记录已保存" });
      await loadInitial();
      if (selectedDepartmentId) {
        await loadDepartmentUsers(selectedDepartmentId);
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "保存续费失败" });
    }
  }

  async function removeRenewal(renewalId: number) {
    if (!selectedUser) return;
    try {
      await deleteMemberRenewal(renewalId);
      const detail = await fetchUserDetail(selectedUser.id);
      setSelectedUser(detail);
      setToast({ type: "success", text: "续费记录已删除" });
      await loadInitial();
      if (selectedDepartmentId) {
        await loadDepartmentUsers(selectedDepartmentId);
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除续费失败" });
    }
  }

  async function createUser(payload: { username: string; email: string; phone?: string; password: string }) {
    try {
      await registerUser(payload);
      setToast({ type: "success", text: "用户创建成功" });
      setNewUserOpen(false);
      await loadInitial();
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "新增用户失败" });
    }
  }

  async function createDept(name: string) {
    try {
      await createDepartment(name);
      setToast({ type: "success", text: "部门创建成功" });
      await loadInitial();
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "创建部门失败" });
    }
  }

  async function removeDept(departmentId: number) {
    try {
      await deleteDepartment(departmentId);
      setToast({ type: "success", text: "部门已删除" });
      await loadInitial();
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除部门失败" });
    }
  }

  async function renameDept(departmentId: number, name: string) {
    try {
      await renameDepartment(departmentId, name);
      setToast({ type: "success", text: "部门名称已更新" });
      await loadInitial();
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "更新部门失败" });
    }
  }

  async function attachUser(departmentId: number, userId: number) {
    try {
      await addUserToDepartment(departmentId, userId);
      setToast({ type: "success", text: "成员已加入部门" });
      await loadDepartmentUsers(departmentId);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "加入部门失败" });
    }
  }

  async function detachUser(departmentId: number, userId: number) {
    try {
      await removeUserFromDepartment(departmentId, userId);
      setToast({ type: "success", text: "成员已移出部门" });
      await loadDepartmentUsers(departmentId);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "移出部门失败" });
    }
  }

  async function savePermissions(departmentId: number, nextIds: string[]) {
    const department = departments.find((item) => item.id === departmentId);
    if (!department) return;

    const currentIds = new Set((department.permissions || []).map((permission) => permission.id));
    const nextSet = new Set(nextIds);

    try {
      await Promise.all([
        ...Array.from(currentIds)
          .filter((id) => !nextSet.has(id))
          .map((id) => removePermissionFromDepartment(departmentId, id)),
        ...Array.from(nextSet)
          .filter((id) => !currentIds.has(id))
          .map((id) => addPermissionToDepartment(departmentId, id)),
      ]);
      setToast({ type: "success", text: "部门权限已更新" });
      setPermissionOpen(false);
      await loadInitial();
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "更新权限失败" });
    }
  }

  return {
    state: {
      departments,
      selectedDepartment,
      selectedDepartmentId,
      departmentUsers,
      allUsers,
      filteredUsers,
      allPermissions,
      selectedUser,
      search,
      loading,
      toast,
      userEditorOpen,
      newUserOpen,
      permissionOpen,
    },
    actions: {
      setSelectedDepartmentId,
      setSearch,
      refresh: loadInitial,
      openUserEditor,
      closeUserEditor: () => setUserEditorOpen(false),
      openNewUser: () => setNewUserOpen(true),
      closeNewUser: () => setNewUserOpen(false),
      openPermissionEditor: () => setPermissionOpen(true),
      closePermissionEditor: () => setPermissionOpen(false),
      saveUser,
      removeUser,
      doResetPassword,
      addRenewal,
      removeRenewal,
      createUser,
      createDept,
      renameDept,
      removeDept,
      attachUser,
      detachUser,
      savePermissions,
    },
  };
}
