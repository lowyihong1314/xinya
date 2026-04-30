import type { YlpOrderItem } from "../types";
import { normalizePhoneMY } from "../../../js/phone";

export const DEFAULT_VERSION = `${new Date().getFullYear()}_YLP`;

export type PaiweiCode = "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C" | "D1";

export type PaiweiTemplate = {
  code: PaiweiCode;
  title: string;
  price: number;
  hint: string;
  defaultSuffix?: string;
  fields: {
    owner?: boolean;
    deceased?: boolean;
    relation?: boolean;
    surname?: boolean;
    suffix?: boolean;
    father?: boolean;
    mother?: boolean;
    quantity?: boolean;
  };
};

export type OrderFormState = {
  customerName: string;
  contactName: string;
  phone: string;
  email: string;
};

export type PaiweiDraft = {
  id: string;
  code: PaiweiCode;
  owner: string;
  deceased: string;
  relation: string;
  surname: string;
  suffix: string;
  father: string;
  mother: string;
  quantity: string;
  note: string;
};

export const PAIWEI_TEMPLATES: PaiweiTemplate[] = [
  {
    code: "A1",
    title: "大牌位_超度历代祖先",
    price: 100,
    hint: "适合祖先牌位，常用姓氏、堂号、父母名与阳上姓名。",
    defaultSuffix: "门堂上历代祖先",
    fields: { owner: true, surname: true, suffix: true, father: true, mother: true },
  },
  {
    code: "A2",
    title: "大牌位_超度亡灵",
    price: 100,
    hint: "必须同时填写阳上与亡者，关系可分行对应。",
    fields: { owner: true, deceased: true, relation: true },
  },
  {
    code: "A3",
    title: "大牌位_无缘子女",
    price: 100,
    hint: "可填写阳上与无缘子女名号。",
    fields: { owner: true, deceased: true },
  },
  {
    code: "B1",
    title: "小牌位_超度历代祖先",
    price: 35,
    hint: "结构与 A1 相同，尺寸较小。",
    defaultSuffix: "门堂上历代祖先",
    fields: { owner: true, surname: true, suffix: true, father: true, mother: true },
  },
  {
    code: "B2",
    title: "小牌位_超度亡灵",
    price: 35,
    hint: "结构与 A2 相同，尺寸较小。",
    fields: { owner: true, deceased: true, relation: true },
  },
  {
    code: "B3",
    title: "小牌位_无缘子女",
    price: 35,
    hint: "结构与 A3 相同，尺寸较小。",
    fields: { owner: true, deceased: true },
  },
  {
    code: "C",
    title: "超度冤亲债主",
    price: 15,
    hint: "通常填写阳上，也可补充对象姓名与关系。",
    fields: { owner: true, deceased: true, relation: true },
  },
  {
    code: "D1",
    title: "普度贡品",
    price: 50,
    hint: "按数量登记，金额会自动计算。",
    fields: { quantity: true },
  },
];

function splitLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toSingleOrArray(values: string[]) {
  if (!values.length) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}

export { normalizePhoneMY };

export function emptyOrderForm(initialPhone = ""): OrderFormState {
  return {
    customerName: "",
    contactName: "",
    phone: initialPhone,
    email: "",
  };
}

export function getTemplate(code: PaiweiCode) {
  return PAIWEI_TEMPLATES.find((template) => template.code === code) || PAIWEI_TEMPLATES[0];
}

export function getDraftQuantity(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  if (!template.fields.quantity) {
    return 1;
  }
  const parsed = Number.parseInt(draft.quantity || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function getDraftUnitPrice(draft: PaiweiDraft) {
  return getTemplate(draft.code).price;
}

export function getDraftTotalPrice(draft: PaiweiDraft) {
  return getDraftUnitPrice(draft) * getDraftQuantity(draft);
}

export function createDraft(code: PaiweiCode = "A1"): PaiweiDraft {
  const template = getTemplate(code);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code,
    owner: "",
    deceased: "",
    relation: "",
    surname: "",
    suffix: template.defaultSuffix || "",
    father: "",
    mother: "",
    quantity: template.fields.quantity ? "1" : "",
    note: "",
  };
}

export function buildItemPayload(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  const ownerValues = splitLines(draft.owner);
  const deceasedValues = splitLines(draft.deceased);
  const relationValues = splitLines(draft.relation);
  const payload: Record<string, unknown> = {
    "form-group": draft.code,
    code: draft.code,
    item_name: template.title,
    price: getDraftTotalPrice(draft),
  };

  const ownerValue = toSingleOrArray(ownerValues);
  const deceasedValue = toSingleOrArray(deceasedValues);
  const relationValue = toSingleOrArray(relationValues);

  if (ownerValue !== undefined) payload.owner = ownerValue;
  if (deceasedValue !== undefined) payload.deceased = deceasedValue;
  if (relationValue !== undefined) payload.relation = relationValue;
  if (template.fields.surname && draft.surname.trim()) payload.surname = draft.surname.trim();
  if (template.fields.suffix && draft.suffix.trim()) payload.suffix = draft.suffix.trim();
  if (template.fields.father && draft.father.trim()) payload.father = draft.father.trim();
  if (template.fields.mother && draft.mother.trim()) payload.mother = draft.mother.trim();
  if (template.fields.quantity) payload.quantity = String(getDraftQuantity(draft));
  if (draft.note.trim()) payload.note = draft.note.trim();

  return payload;
}

export function validateDraft(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  const ownerValues = splitLines(draft.owner);
  const deceasedValues = splitLines(draft.deceased);

  if (template.fields.quantity) {
    const quantity = Number.parseInt(draft.quantity || "", 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `${template.title} 的数量必须大于 0`;
    }
  }

  if (ownerValues.some((value) => value.length > 50)) {
    return `${template.title} 的阳上姓名不能超过 50 个字`;
  }

  if (deceasedValues.some((value) => value.length > 50)) {
    return `${template.title} 的对象姓名不能超过 50 个字`;
  }

  if (draft.code === "D1") {
    return null;
  }

  if (draft.code === "A2" || draft.code === "B2") {
    if (!ownerValues.length || !deceasedValues.length) {
      return `${template.title} 需要同时填写阳上与亡者`;
    }
  } else if (!ownerValues.length && !deceasedValues.length) {
    return `${template.title} 至少要填写阳上或对象其中一项`;
  }

  return null;
}

export function summarizeItem(item: YlpOrderItem) {
  const grouped = item.item_form_data || {};
  const labelMap: Record<string, string> = {
    owner: "阳上",
    deceased: "对象",
    father: "父名",
    mother: "母名",
    relation: "关系",
    surname: "姓氏",
    suffix: "内容",
    quantity: "数量",
  };

  const parts: string[] = [];
  for (const key of ["owner", "deceased", "father", "mother", "relation", "surname", "suffix", "quantity"]) {
    const values = grouped[key];
    if (!values?.length) {
      continue;
    }
    const joined = values
      .map((entry) => String(entry.val || "").trim())
      .filter(Boolean)
      .join(" / ");
    if (joined) {
      parts.push(`${labelMap[key] || key}：${joined}`);
    }
  }
  return parts.join(" · ");
}
