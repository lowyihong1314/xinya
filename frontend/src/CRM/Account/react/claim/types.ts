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
  applicant_user_id?: number | null;
  applicant_name?: string;
  amount?: number | string;
  request_date?: string;
  department_name?: string;
  purpose?: string;
  event_id?: number;
  event_name?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  is_locked?: boolean;
  sign_json_data?: unknown;
  public_token?: string;
  voucher_recipient_name?: string;
  voucher_recipient_sign_json?: unknown;
  voucher_signed_at?: string;
  attachments?: ClaimAttachment[];
  approver_data?: ClaimApprover[];
};

export type ClaimListResponse = {
  data?: ClaimRecord[];
  can_view_all?: boolean;
};

export type PaymentVoucherSharePayload = {
  share_url: string;
  token: string;
  claim: ClaimRecord;
  approver_data?: ClaimApprover[];
  is_signed: boolean;
};

export type PaymentVoucherPublicPayload = {
  claim: ClaimRecord;
  approver_data?: ClaimApprover[];
  is_signed: boolean;
};

export type ApproverUserProfile = {
  id: number;
  username?: string;
  display_name?: string;
  name_NRIC?: string;
};
