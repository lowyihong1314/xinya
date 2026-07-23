// 本机草稿：记录这批登记里谁的家长同意书还没完成，方便晚上同设备继续。

export type DraftPerson = {
  nric: string;
  name: string;
  name_cn: string;
  phone: string;
  needConsent: boolean;
  submitted: boolean;
  consentDone: boolean;
  // 紧急联络人（家长同意书里家长通常就是紧急联络人，用来预填）。
  parent_1?: string;
  parent_1_phone?: string;
};

export type RegisterDraft = {
  path: "single" | "family";
  people: DraftPerson[];
  updatedAt: number;
};

const KEY = (formId: number | string) => `xinya_form_register_draft_v2_${formId}`;

export function loadDraft(formId: number): RegisterDraft | null {
  try {
    const raw = localStorage.getItem(KEY(formId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegisterDraft;
    if (!parsed || !Array.isArray(parsed.people)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(formId: number, draft: RegisterDraft): void {
  try {
    localStorage.setItem(KEY(formId), JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    /* localStorage 不可用时静默忽略 */
  }
}

export function clearDraft(formId: number): void {
  try {
    localStorage.removeItem(KEY(formId));
  } catch {
    /* noop */
  }
}

export function pendingConsentPeople(draft: RegisterDraft | null): DraftPerson[] {
  if (!draft) return [];
  return draft.people.filter((p) => p.submitted && p.needConsent && !p.consentDone);
}
