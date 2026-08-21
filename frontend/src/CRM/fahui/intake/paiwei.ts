import type { YlpOrderItem } from "../types";
import { normalizePhoneMY } from "../../../js/phone";

/** 登记页只写今年的版本号；提交时用函数现算，避免页面开着跨年后仍沿用旧年份。 */
export function currentYlpVersion() {
  return `${new Date().getFullYear()}_YLP`;
}

export const DEFAULT_VERSION = currentYlpVersion();

export type PaiweiCode = "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C" | "D1";

export type PaiweiTemplate = {
  code: PaiweiCode;
  title: string;
  price: number;
  hint: string;
  /** 今年停售：不出现在「牌位类型」下拉里，但历史订单仍能正常显示与编辑。 */
  retired?: boolean;
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
    hint: "超度历代祖先：填写姓氏、堂号、显考（先父）、显妣（先母）与阳上姓名。",
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
    // 无缘子女没有「显考/显妣」——父母是在生的阳上，牌位印「阳上 父 X 母 Y」。
    hint: "填写无缘子女名号，以及在生的父／母（阳上）。",
    fields: { owner: true, deceased: true, father: true, mother: true },
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
    hint: "结构与 A3 相同，尺寸较小。父／母同样是在生的阳上。",
    fields: { owner: true, deceased: true, father: true, mother: true },
  },
  {
    code: "C",
    title: "超度冤亲债主",
    price: 15,
    // 与打印模板一致：牌位中央固定印「冤亲债主」，只需要阳上姓名。
    hint: "填写一位阳上姓名即可，牌位内容固定为「冤亲债主」。",
    fields: { owner: true },
  },
  {
    code: "D1",
    title: "普度贡品",
    price: 50,
    hint: "按数量登记，金额会自动计算。",
    retired: true, // 2026 年没有这一项；明年恢复时删掉这行即可。
    fields: { quantity: true },
  },
];

/** 「牌位类型」下拉可选的模板；正在编辑的旧项目若属停售类型，仍保留其选项以正确显示。 */
export function selectableTemplates(currentCode?: PaiweiCode): PaiweiTemplate[] {
  return PAIWEI_TEMPLATES.filter((template) => !template.retired || template.code === currentCode);
}

function splitLines(value: string) {
  // 只按换行拆分（不再按逗号）——名字里带逗号不会被误拆成两个人。
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// 供牌位编辑器用：多人字段在 draft 里用换行拼接，UI 用数组维护。
export function linesToArray(value: string): string[] {
  return splitLines(value);
}

export function arrayToLines(values: string[]): string {
  return values.map((entry) => entry.trim()).filter(Boolean).join("\n");
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

// 从已保存的订单项目反推出编辑草稿（CRM 端编辑既有牌位时用）。
export function draftFromItem(item: YlpOrderItem): PaiweiDraft {
  const code = PAIWEI_TEMPLATES.some((tpl) => tpl.code === item.code) ? (item.code as PaiweiCode) : "A1";
  const base = createDraft(code);
  const values = (key: string) =>
    (item.item_form_data?.[key] || []).map((entry) => String(entry.val ?? "").trim()).filter(Boolean);
  const first = (key: string) => values(key)[0] || "";
  return {
    ...base,
    owner: values("owner").join("\n"),
    deceased: values("deceased").join("\n"),
    relation: values("relation").join("\n"),
    surname: first("surname"),
    suffix: first("suffix") || base.suffix,
    father: first("father"),
    mother: first("mother"),
    quantity: first("quantity") || base.quantity,
    note: first("note"),
  };
}

/** 无缘子女（A3/B3）的父母是在生的阳上，不能叫显考/显妣。 */
export function isWuyuanCode(code?: string | null): boolean {
  return code === "A3" || code === "B3";
}

export function paiweiFieldLabel(key: string, code?: string | null): string {
  const wuyuan = isWuyuanCode(code);
  const labels: Record<string, string> = {
    owner: "阳上",
    deceased: wuyuan ? "子女" : "对象",
    relation: "关系",
    surname: "姓氏",
    suffix: "内容",
    father: wuyuan ? "阳上 父" : "显考",
    mother: wuyuan ? "阳上 母" : "显妣",
    quantity: "数量",
    note: "备注",
  };
  return labels[key] || key;
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
  } else if (draft.code === "C") {
    if (!ownerValues.length) {
      return `${template.title} 需要填写阳上姓名`;
    }
    if (ownerValues.length > 1) {
      return `${template.title} 只能填写一位阳上姓名`;
    }
  } else if (isWuyuanCode(draft.code)) {
    // 无缘子女的阳上（含父 / 母）最多两位，公开端与 CRM 同一条规则
    const parents = [draft.father?.trim(), draft.mother?.trim()].filter(Boolean).length;
    if (ownerValues.length + parents > 2) {
      return `${template.title} 的阳上最多只能填两位`;
    }
    if (!ownerValues.length && !parents && !deceasedValues.length) {
      return `${template.title} 至少要填写阳上或子女其中一项`;
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
