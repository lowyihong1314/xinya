// 桥接旧版家长同意书弹窗（协议文本 + 签名板 + 发给家长远程签）。管理端已用同一模块。
import { open_parental_form } from "../../../../../static/js/form/parental/modal.js";
import type { Person, PublicForm } from "./types";

export type ParentalPayload = Record<string, unknown> | null;

export async function collectParentalConsent(
  form: PublicForm,
  person: Person,
  prefill: Record<string, unknown>,
): Promise<ParentalPayload> {
  const payload = {
    id: form.id,
    nric: person.nric,
    name: person.name,
    name_cn: person.name_cn,
    phone: person.phone,
  };
  const parent = await open_parental_form(form, payload, prefill, false, true, {
    skipPdfExport: true,
    okLabel: "提交同意书",
    nullOnClose: true,
  });
  return (parent as ParentalPayload) || null;
}
