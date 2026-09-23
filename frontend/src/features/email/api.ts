/**
 * 公司邮箱。后端 backend/api/email/router.py（挂载前缀 /email）。
 *
 * ⚠️ 这些接口的成功响应也带 {"status":"success", ...}，不是裸数据 ——
 *    后端信封只有一套，业务成功体是各接口自己的形状。别在 http 客户端里剥。
 */
import { http } from "@/shared/api/client";

import type { EmailListResponse } from "./types";

export const emailKeys = {
  all: ["email"] as const,
  list: () => [...emailKeys.all, "list"] as const,
};

export const fetchEmails = () => http.get<EmailListResponse>("/email/list");

export interface SendEmailInput {
  to_email: string;
  subject: string;
  body: string;
  cc_email?: string;
  bcc_email?: string;
}

export const sendEmail = (input: SendEmailInput) => http.post("/email/send", input);

/** 改接收邮箱：先发验证邮件，点链接后才生效。 */
export const requestEmailChange = (email: string) => http.post("/email/change-request", { email });

/** 给「已有但未验证」的当前邮箱补发验证链接。 */
export const requestEmailVerify = () => http.post("/email/verify-request");
