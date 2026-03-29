type PermissionRef = {
  name?: string | null;
};

type DepartmentRef = {
  permissions?: PermissionRef[] | null;
};

type UserWithDepartments = {
  departments?: DepartmentRef[] | null;
};

export function getUserPermissionNames(user: unknown): Set<string> {
  if (!user || typeof user !== "object") {
    return new Set();
  }

  const departments = Array.isArray((user as UserWithDepartments).departments)
    ? (user as UserWithDepartments).departments || []
    : [];

  return new Set(
    departments.flatMap((department) =>
      (department?.permissions || [])
        .map((permission) => permission?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );
}

export function hasUserPermission(user: unknown, permissionName: string): boolean {
  return getUserPermissionNames(user).has(permissionName);
}
