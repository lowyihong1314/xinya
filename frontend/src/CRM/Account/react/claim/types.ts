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

export type ClaimChangeLog = {
  id: number;
  field_name?: string;
  old_value?: string | null;
  new_value?: string | null;
  changed_by_user_id?: number | null;
  changed_by_name?: string | null;
  created_at?: string;
};

export type ClaimRecord = {
  id: number;
  applicant_user_id?: number | null;
  applicant_name?: string;
  amount?: number | string;
  request_date?: string;
  department_name?: string;
  purpose?: string;
  ref1?: string | null;
  ref2?: string | null;
  vendor_name?: string | null;
  vendor_address?: string | null;
  vendor_contact_number?: string | null;
  purchase_datetime?: string | null;
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
  change_logs?: ClaimChangeLog[];
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

export type ReadBillReceiptItem = {
  itemNumber?: string | number;
  description?: string;
  expenseCategory?: string;
  quantity?: string | number;
  lineTotal?: string | number;
};

export type ReadBillData = {
  [key: string]: unknown;
  merchantName?: string | null;
  merchant_name?: string | null;
  receiptNumber?: string | null;
  receiptDate?: string | null;
  receipt_date?: string | null;
  receiptDateTime?: string | null;
  receipt_date_time?: string | null;
  purchaseDateTime?: string | null;
  purchaseDatetime?: string | null;
  purchase_datetime?: string | null;
  purchaseDate?: string | null;
  purchase_date?: string | null;
  currency?: string | null;
  expenseCategory?: string | null;
  description?: string | null;
  merchantAddress?: string | null;
  merchant_address?: string | null;
  vendorName?: string | null;
  vendor_name?: string | null;
  vendorAddress?: string | null;
  vendor_address?: string | null;
  vendorData?: unknown;
  vendor_data?: unknown;
  amountBeforeTax?: string | number | null;
  taxAmount?: string | number | null;
  totalAmount?: string | number | null;
  total_amount?: string | number | null;
  receiptItems?: ReadBillReceiptItem[];
  receipt_items?: ReadBillReceiptItem[];
};

export type ReadBillMeta = {
  confidence?: string | number | null;
  needsReview?: boolean;
  sampleId?: string;
  source?: string;
  storedFile?: string;
};

export type ReadBillUploadResponse = {
  status?: string;
  success?: boolean;
  data?: ReadBillData;
  meta?: ReadBillMeta;
};

export type ApproverUserProfile = {
  id: number;
  username?: string;
  display_name?: string;
  name_NRIC?: string;
};
