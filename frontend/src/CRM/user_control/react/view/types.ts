import type {
  DepartmentRecord,
  PermissionRecord,
  UserRecord,
} from "../types";

export type Toast = { type: "success" | "error"; text: string } | null;

export type CreateUserPayload = {
  username: string;
  email: string;
  phone?: string;
  password: string;
};

export type UserEditorPayload = {
  username: string;
  display_name: string;
  email: string;
  phone: string;
  name_NRIC: string;
  display: boolean;
  is_member: boolean;
  NRIC: string;
  gender: string;
  parent_1: string;
  parent_1_phone: string;
  medical: string;
  allergy: string;
};

export type MemberRenewalPayload = {
  renewal_date: string;
  note?: string;
  proof?: File | null;
};

export type UserControlViewProps = {
  isMobile?: boolean;
  departments: DepartmentRecord[];
  selectedDepartment: DepartmentRecord | null;
  selectedDepartmentId: number | null;
  departmentUsers: UserRecord[];
  filteredUsers: UserRecord[];
  allPermissions: PermissionRecord[];
  selectedUser: UserRecord | null;
  search: string;
  loading: boolean;
  toast: Toast;
  userEditorOpen: boolean;
  newUserOpen: boolean;
  permissionOpen: boolean;
  onSelectDepartment: (departmentId: number) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenUser: (userId: number) => void;
  onOpenNewUser: () => void;
  onCloseNewUser: () => void;
  onCreateUser: (payload: CreateUserPayload) => void;
  onCreateDepartment: (name: string) => void;
  onRenameDepartment: (departmentId: number, name: string) => void;
  onDeleteDepartment: (departmentId: number) => void;
  onAttachUser: (departmentId: number, userId: number) => void;
  onDetachUser: (departmentId: number, userId: number) => void;
  onOpenPermissionEditor: () => void;
  onClosePermissionEditor: () => void;
  onSavePermissions: (departmentId: number, nextIds: number[]) => void;
  onCloseUserEditor: () => void;
  onSaveUser: (payload: UserEditorPayload) => void;
  onDeleteUser: (userId: number) => void;
  onResetPassword: (userId: number) => void;
  onCreateRenewal: (payload: MemberRenewalPayload) => void;
  onDeleteRenewal: (renewalId: number) => void;
};
