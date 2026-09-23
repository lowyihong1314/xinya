/**
 * 报销（claim）。后端 backend/api/account/router.py + serializers.py。
 * 形状来自后端 serializers.serialize_request_data（接口要登录，实测不到）。
 */

/** 逐项明细。**整单金额 = 各行 amount 合计**，后端已经清洗成必有明细的结构。 */
export interface ClaimLineItem {
  id: number;
  description?: string | null;
  amount: number | string;
  [key: string]: unknown;
}

export interface ClaimAttachment {
  id: number;
  file_name?: string | null;
  [key: string]: unknown;
}

export interface ClaimApprover {
  user_id?: number;
  name?: string | null;
  decision?: string | null;
  [key: string]: unknown;
}

export interface Claim {
  id: number;
  applicant_user_id: number;
  applicant_name: string | null;
  request_date: string | null;
  amount: number | string;
  department_id: number | null;
  department_name: string | null;
  purpose: string | null;
  line_items: ClaimLineItem[];

  /** 供应商资料 */
  vendor_name: string | null;
  vendor_address: string | null;
  vendor_contact_number: string | null;
  purchase_datetime: string | null;

  /** 收款资料（表头）。 */
  bank_name: string | null;
  bank_account: string | null;
  account_name: string | null;

  /** 公开签名链接的 token。 */
  public_token: string | null;
  event_id: number | null;
  event_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** 锁定后不可编辑。 */
  is_locked: boolean;

  /** ★ 形如 "2/0" —— 「通过数/否决数」，**不是**枚举状态。别当字符串状态用。 */
  status: string;
  attachments: ClaimAttachment[];
  approver_data: ClaimApprover[];
  change_logs: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ClaimListResponse {
  status: string;
  /** 有 account_read 之类权限时为 true，能看到所有人的单；否则只有自己的。 */
  can_view_all: boolean;
  count: number;
  data: Claim[];
}
