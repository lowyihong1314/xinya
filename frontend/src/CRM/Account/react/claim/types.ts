export type Permission = {
  name?: string;
};

export type Department = {
  id: number;
  name: string;
  permissions?: Permission[];
};

export type AccountUser = {
  id: number;
  username: string;
  display_name?: string;
  name_NRIC?: string;
  email?: string;
  phone?: string;
  NRIC?: string;
  departments?: Department[];
};

export type ClaimAttachment = {
  id?: number;
  file_name?: string;
  file_path: string;
  mime_type?: string;
};

export type ClaimApprover = {
  id?: number;
  user_id: number;
  dep_id?: number;
  decided_at?: string;
  reject: boolean;
  sign_json_data?: unknown;
};

export type ClaimRecord = {
  id: number;
  applicant_name?: string;
  amount?: number | string;
  request_date?: string;
  department_id?: number;
  department_name?: string;
  purpose?: string;
  event_id?: number;
  event_name?: string;
  created_at?: string;
  status?: string;
  sign_json_data?: unknown;
  attachments?: ClaimAttachment[];
  approver_data?: ClaimApprover[];
};

export type ClaimListResponse = {
  data?: ClaimRecord[];
  can_view_all?: boolean;
};

export type ApproverUserProfile = {
  id: number;
  username?: string;
  display_name?: string;
  name_NRIC?: string;
};
