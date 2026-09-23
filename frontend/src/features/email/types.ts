/** 后端 /email/* 的数据形状。见 backend/api/email/router.py。 */
export interface EmailLog {
  id: number;
  from_email: string;
  to_email: string;
  cc_email: string | null;
  bcc_email: string | null;
  subject: string;
  body: string;
  direction: "sent" | "received";
  /** pending 是「已落库、正在发」。发送失败会变 failed 并带 error_message。 */
  status: "pending" | "success" | "failed";
  error_message?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface EmailListResponse {
  status: string;
  data: EmailLog[];
  /** 当前账号的公司邮箱 {username}@utba.my，界面上显示「发件人」。 */
  from_email: string;
}
