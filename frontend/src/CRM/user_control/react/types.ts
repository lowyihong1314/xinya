// 权限清单已代码化：id 就是权限名字符串。
export type PermissionRecord = {
  id: string;
  name: string;
  ref?: string | null;
  description?: string | null;
};

export type DepartmentRecord = {
  id: number;
  name: string;
  permissions?: PermissionRecord[];
};

export type MemberRenewalRecord = {
  id: number;
  user_id: number;
  renewal_date?: string | null;
  proof_path?: string | null;
  proof_name?: string | null;
  proof_mime?: string | null;
  note?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at?: string | null;
};

export type UserRecord = {
  id: number;
  username?: string | null;
  display_name?: string | null;
  nric_asset_id?: number | null;
  nric_data_id?: number | null;
  email?: string | null;
  phone?: string | null;
  name_NRIC?: string | null;
  display?: boolean | null;
  is_member?: boolean | null;
  xin_ya?: boolean | null;
  age?: number | null;
  member_renewals?: MemberRenewalRecord[];
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
