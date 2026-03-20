export type PermissionRecord = {
  id: number;
  name: string;
  ref?: string | null;
};

export type DepartmentRecord = {
  id: number;
  name: string;
  permissions?: PermissionRecord[];
};

export type UserRecord = {
  id: number;
  username?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  name_NRIC?: string | null;
  display?: boolean | null;
  NRIC?: string | null;
  gender?: string | null;
  parent_1?: string | null;
  parent_1_phone?: string | null;
  medical?: string | null;
  allergy?: string | null;
  created_at?: string | null;
  departments?: DepartmentRecord[];
};

export type DepartmentUsersResponse = {
  id: number;
  name: string;
  login?: boolean;
  users?: UserRecord[];
  status?: string;
  message?: string;
};

