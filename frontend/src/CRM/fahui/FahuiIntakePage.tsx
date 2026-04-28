import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { get_phone_on_localhost } from "../../js/get_phone_on_localhost";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import {
  createYlpOrder,
  createYlpOrderItem,
  fetchYlpOrderDetail,
  fetchYlpOrdersByPhone,
  fetchYlpVersions,
} from "./api";
import type { YlpOrderDetail, YlpOrderItem, YlpOrderSummary } from "./types";

const DEFAULT_VERSION = "2025_YLP";

type IntakeMode = "new" | "existing";
type PaiweiCode = "A1" | "A2" | "A3" | "B1" | "B2" | "B3" | "C" | "D1";

type PaiweiTemplate = {
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

type OrderFormState = {
  customerName: string;
  contactName: string;
  memberName: string;
  phone: string;
  email: string;
};

type PaiweiDraft = {
  id: string;
  code: PaiweiCode;
  itemName: string;
  price: string;
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

const PAIWEI_TEMPLATES: PaiweiTemplate[] = [
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
    hint: "必须同时填写阳上与亡者，关系支持一行对应一位亡者。",
    fields: { owner: true, deceased: true, relation: true },
  },
  {
    code: "A3",
    title: "大牌位_无缘子女",
    price: 100,
    hint: "可填写阳上与无缘子女名号；若只写“无缘子女”，系统也能打印。",
    fields: { owner: true, deceased: true },
  },
  {
    code: "B1",
    title: "小牌位_超度历代祖先",
    price: 35,
    hint: "结构与 A1 一样，只是牌位尺寸较小。",
    defaultSuffix: "门堂上历代祖先",
    fields: { owner: true, surname: true, suffix: true, father: true, mother: true },
  },
  {
    code: "B2",
    title: "小牌位_超度亡灵",
    price: 35,
    hint: "结构与 A2 一样，只是牌位尺寸较小。",
    fields: { owner: true, deceased: true, relation: true },
  },
  {
    code: "B3",
    title: "小牌位_无缘子女",
    price: 35,
    hint: "结构与 A3 一样，只是牌位尺寸较小。",
    fields: { owner: true, deceased: true },
  },
  {
    code: "C",
    title: "超度冤亲债主",
    price: 15,
    hint: "多半只需阳上，若习惯写对象名也可以带 deceased 一并提交。",
    fields: { owner: true, deceased: true, relation: true },
  },
  {
    code: "D1",
    title: "普度贡品",
    price: 50,
    hint: "这类不会印牌位，通常填数量、备注或直接改总价。",
    fields: { quantity: true },
  },
];

function normalizePhoneMY(raw: string) {
  const trimmed = raw.trim();
  const numeric = trimmed.replace(/\D+/g, "");
  if (!numeric) {
    return "";
  }
  if (trimmed.startsWith("+")) {
    return trimmed;
  }
  if (numeric.startsWith("0")) {
    return `+60${numeric.slice(1)}`;
  }
  if (numeric.startsWith("60")) {
    return `+${numeric}`;
  }
  return `+60${numeric}`;
}

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

function getTemplate(code: PaiweiCode) {
  return PAIWEI_TEMPLATES.find((template) => template.code === code) || PAIWEI_TEMPLATES[0];
}

function createDraft(code: PaiweiCode = "A1"): PaiweiDraft {
  const template = getTemplate(code);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code,
    itemName: template.title,
    price: String(template.price),
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

function buildItemPayload(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  const ownerValues = splitLines(draft.owner);
  const deceasedValues = splitLines(draft.deceased);
  const relationValues = splitLines(draft.relation);
  const payload: Record<string, unknown> = {
    "form-group": draft.code,
    code: draft.code,
    item_name: draft.itemName.trim() || template.title,
    price: Number(draft.price || template.price),
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
  if (template.fields.quantity && draft.quantity.trim()) payload.quantity = draft.quantity.trim();
  if (draft.note.trim()) payload.note = draft.note.trim();

  return payload;
}

function validateDraft(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  const ownerValues = splitLines(draft.owner);
  const deceasedValues = splitLines(draft.deceased);

  if (!draft.itemName.trim()) {
    return "请填写项目名称";
  }

  if (!draft.price.trim() || Number.isNaN(Number(draft.price)) || Number(draft.price) < 0) {
    return `${template.title} 的金额无效`;
  }

  if (ownerValues.some((value) => value.length > 50)) {
    return `${template.title} 的阳上姓名不能超过 50 个字`;
  }

  if (draft.code === "D1") {
    return null;
  }

  if (draft.code === "A2" || draft.code === "B2") {
    if (!ownerValues.length || !deceasedValues.length) {
      return `${template.title} 必须同时填写阳上与亡者`;
    }
  } else if (!ownerValues.length && !deceasedValues.length) {
    return `${template.title} 至少要填写阳上或亡者其中一项`;
  }

  return null;
}

function summarizeItem(item: YlpOrderItem) {
  const grouped = item.item_form_data || {};
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
      parts.push(`${key}: ${joined}`);
    }
  }
  return parts.join(" · ");
}

function emptyOrderForm(initialPhone = ""): OrderFormState {
  return {
    customerName: "",
    contactName: "",
    memberName: "",
    phone: initialPhone,
    email: "",
  };
}

export function FahuiIntakePage() {
  useEnsureDesignTokens();

  const { isAuthenticated, isMobile, user } = useUserState();
  const [mode, setMode] = useState<IntakeMode>("new");
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [orderForm, setOrderForm] = useState<OrderFormState>(() => emptyOrderForm());
  const [drafts, setDrafts] = useState<PaiweiDraft[]>(() => [createDraft()]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [existingOrders, setExistingOrders] = useState<YlpOrderSummary[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<YlpOrderDetail | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedTemplateTotals = useMemo(
    () =>
      drafts.reduce((total, draft) => {
        const price = Number(draft.price || 0);
        return total + (Number.isNaN(price) ? 0 : price);
      }, 0),
    [drafts],
  );

  useEffect(() => {
    const savedPhone = typeof window !== "undefined" ? normalizePhoneMY(localStorage.getItem("my_phone_number") || "") : "";
    if (savedPhone) {
      setOrderForm((current) => ({ ...current, phone: current.phone || savedPhone }));
    }

    async function loadVersions() {
      setVersionsLoading(true);
      try {
        const payload = await fetchYlpVersions();
        const nextVersions = (payload.data || []).filter(Boolean);
        setVersions(nextVersions);
        setVersion(nextVersions[0] || DEFAULT_VERSION);
      } catch {
        setVersions([]);
        setVersion(DEFAULT_VERSION);
      } finally {
        setVersionsLoading(false);
      }
    }

    void loadVersions();
  }, []);

  async function ensurePhoneAccess(rawPhone: string) {
    const normalizedPhone = normalizePhoneMY(rawPhone);
    if (!normalizedPhone) {
      throw new Error("请先填写手机号码");
    }

    if (isAuthenticated) {
      return normalizedPhone;
    }

    const savedPhone = normalizePhoneMY(localStorage.getItem("my_phone_number") || "");
    if (savedPhone && savedPhone !== normalizedPhone) {
      localStorage.removeItem("my_phone_number");
    }

    const verifiedPhone = normalizePhoneMY(await get_phone_on_localhost());
    if (!verifiedPhone || verifiedPhone !== normalizedPhone) {
      localStorage.removeItem("my_phone_number");
      throw new Error("请使用订单手机号完成验证后再继续");
    }

    return normalizedPhone;
  }

  async function refreshExistingOrders(phone: string, preferredOrderId?: number | null) {
    const payload = await fetchYlpOrdersByPhone(phone);
    const items = payload.data?.items || [];
    setExistingOrders(items);

    const fallbackId = preferredOrderId || items[0]?.id || null;
    if (fallbackId) {
      await loadOrderDetail(fallbackId);
    } else {
      setSelectedOrderId(null);
      setSelectedOrderDetail(null);
    }

    return items;
  }

  function consumeAccessError(nextError: unknown) {
    const text = nextError instanceof Error ? nextError.message : "请求失败";
    if (!isAuthenticated && /(手机验证|没有权限|未登录)/.test(text)) {
      localStorage.removeItem("my_phone_number");
    }
    return text;
  }

  async function loadOrderDetail(orderId: number) {
    setOrderDetailLoading(true);
    try {
      const payload = await fetchYlpOrderDetail(orderId);
      const detail = payload.data || null;
      setSelectedOrderId(orderId);
      setSelectedOrderDetail(detail);
      if (detail) {
        setOrderForm((current) => ({
          ...current,
          customerName: detail.customer_name || "",
          contactName: detail.name || detail.customer_name || "",
          memberName: detail.member_name || "",
          phone: detail.phone || current.phone,
          email: detail.email || "",
        }));
      }
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setOrderDetailLoading(false);
    }
  }

  async function handleLookupOrders() {
    setError("");
    setMessage("");
    setLookupLoading(true);
    try {
      const verifiedPhone = await ensurePhoneAccess(orderForm.phone);
      setOrderForm((current) => ({ ...current, phone: verifiedPhone }));
      const items = await refreshExistingOrders(verifiedPhone);
      setMode("existing");
      if (!items.length) {
        setMessage("这个手机号目前还没有订单，可以直接切到“新建功德主订单”开始填写。");
      }
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setLookupLoading(false);
    }
  }

  function updateDraft(index: number, patch: Partial<PaiweiDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  function handleChangeDraftCode(index: number, code: PaiweiCode) {
    const template = getTemplate(code);
    setDrafts((current) =>
      current.map((draft, draftIndex) => {
        if (draftIndex !== index) {
          return draft;
        }
        const previousTemplate = getTemplate(draft.code);
        const shouldResetPrice = !draft.price.trim() || Number(draft.price) === previousTemplate.price;
        return {
          ...draft,
          code,
          itemName: template.title,
          price: shouldResetPrice ? String(template.price) : draft.price,
          owner: template.fields.owner ? draft.owner : "",
          deceased: template.fields.deceased ? draft.deceased : "",
          surname: template.fields.surname ? draft.surname : "",
          suffix: template.defaultSuffix || "",
          father: template.fields.father ? draft.father : "",
          mother: template.fields.mother ? draft.mother : "",
          relation: template.fields.relation ? draft.relation : "",
          quantity: template.fields.quantity ? draft.quantity || "1" : "",
        };
      }),
    );
  }

  function addDraft(code?: PaiweiCode) {
    setDrafts((current) => [...current, createDraft(code || "A1")]);
  }

  function removeDraft(index: number) {
    setDrafts((current) => (current.length <= 1 ? [createDraft()] : current.filter((_, currentIndex) => currentIndex !== index)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const normalizedPhone = normalizePhoneMY(orderForm.phone);
    if (!normalizedPhone) {
      setError("请先填写手机号码");
      return;
    }

    if (mode === "new") {
      if (!orderForm.customerName.trim()) {
        setError("请先填写功德主");
        return;
      }
      if (!(orderForm.contactName.trim() || orderForm.customerName.trim())) {
        setError("请先填写联系人");
        return;
      }
    }

    for (const draft of drafts) {
      const validationError = validateDraft(draft);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSubmitting(true);
    try {
      const verifiedPhone = await ensurePhoneAccess(normalizedPhone);
      let orderId = selectedOrderId;

      if (mode === "new") {
        const createPayload = await createYlpOrder({
          version,
          name: orderForm.contactName.trim() || orderForm.customerName.trim(),
          customer_name: orderForm.customerName.trim() || undefined,
          member_name: orderForm.memberName.trim() || undefined,
          phone: verifiedPhone,
          email: orderForm.email.trim() || undefined,
        });

        orderId = createPayload.order?.id || null;
        if (!orderId) {
          throw new Error(createPayload.message || "创建订单失败");
        }
      } else if (!orderId) {
        throw new Error("请先选择要追加牌位的订单");
      }

      for (let index = 0; index < drafts.length; index += 1) {
        const payload = buildItemPayload(drafts[index]);
        const result = await createYlpOrderItem(orderId, payload);
        if (!result.success) {
          throw new Error(result.message || `第 ${index + 1} 个牌位保存失败`);
        }
      }

      setOrderForm((current) => ({ ...current, phone: verifiedPhone }));
      await refreshExistingOrders(verifiedPhone, orderId);
      setDrafts([createDraft()]);
      setMode("existing");
      setMessage(`已成功写入订单 #${orderId}，本次新增 ${drafts.length} 个项目。`);
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fahui-intake__page" style={pageStyle}>
      <div className="fahui-intake__shell" style={shellStyle(isMobile)}>
        <section className="fahui-intake__hero" style={heroStyle}>
          <div className="fahui-intake__eyebrow" style={eyebrowStyle}>
            YLP Intake
          </div>
          <h1 className="fahui-intake__title" style={titleStyle(isMobile)}>
            盂兰盆牌位对外填写
          </h1>
          <div className="fahui-intake__lead" style={leadStyle}>
            这页直接顺着现有 `orders / order_items / item_form_data` 结构提交，可新建功德主订单，也可为既有订单继续加牌位。
          </div>
          <div className="fahui-intake__hint-row" style={badgeRowStyle}>
            <span className="fahui-intake__badge" style={badgeStyle}>
              当前版本：{versionsLoading ? "读取中…" : version}
            </span>
            <span className="fahui-intake__badge" style={badgeStyle}>
              {isAuthenticated ? `已登录，可代客户填写 · ${String(user?.username || "")}` : "未登录时会要求手机号验证"}
            </span>
          </div>
        </section>

        <section className="fahui-intake__panel" style={panelStyle}>
          <div className="fahui-intake__mode-row" style={modeRowStyle(isMobile)}>
            <button
              type="button"
              className="fahui-intake__mode-button"
              style={modeButtonStyle(mode === "new")}
              onClick={() => {
                setMode("new");
                setSelectedOrderId(null);
                setSelectedOrderDetail(null);
              }}
            >
              新建功德主订单
            </button>
            <button
              type="button"
              className="fahui-intake__mode-button"
              style={modeButtonStyle(mode === "existing")}
              onClick={() => setMode("existing")}
            >
              给已有订单加牌位
            </button>
          </div>

          {error ? (
            <div className="fahui-intake__banner fahui-intake__banner--error" style={errorBannerStyle}>
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="fahui-intake__banner fahui-intake__banner--success" style={successBannerStyle}>
              {message}
            </div>
          ) : null}

          <form className="fahui-intake__form" style={formStyle} onSubmit={handleSubmit}>
            <div className="fahui-intake__section-header" style={sectionHeaderStyle}>
              <div>
                <div className="fahui-intake__section-title" style={sectionTitleStyle}>
                  订单归属
                </div>
                <div className="fahui-intake__section-copy" style={sectionCopyStyle}>
                  外部访客会把订单绑定到已验证手机号；若你要代其他客户填写，请先登录 CRM 再进入这页。
                </div>
              </div>
            </div>

            <div className="fahui-intake__field-grid" style={fieldGridStyle(isMobile)}>
              <label className="fahui-intake__field" style={fieldStyle}>
                <span style={labelStyle}>法会版本</span>
                <select
                  className="fahui-intake__select"
                  style={inputStyle}
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                >
                  {(versions.length ? versions : [DEFAULT_VERSION]).map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="fahui-intake__field" style={fieldStyle}>
                <span style={labelStyle}>订单手机号</span>
                <input
                  className="fahui-intake__input"
                  style={inputStyle}
                  value={orderForm.phone}
                  placeholder="例如 0123456789"
                  onChange={(event) => setOrderForm((current) => ({ ...current, phone: event.target.value }))}
                />
              </label>

              {mode === "new" ? (
                <>
                  <label className="fahui-intake__field" style={fieldStyle}>
                    <span style={labelStyle}>功德主</span>
                    <input
                      className="fahui-intake__input"
                      style={inputStyle}
                      value={orderForm.customerName}
                      placeholder="牌位订单显示给财务与打印的主要姓名"
                      onChange={(event) => setOrderForm((current) => ({ ...current, customerName: event.target.value }))}
                    />
                  </label>

                  <label className="fahui-intake__field" style={fieldStyle}>
                    <span style={labelStyle}>联系人</span>
                    <input
                      className="fahui-intake__input"
                      style={inputStyle}
                      value={orderForm.contactName}
                      placeholder="不填时会自动沿用功德主"
                      onChange={(event) => setOrderForm((current) => ({ ...current, contactName: event.target.value }))}
                    />
                  </label>

                  <label className="fahui-intake__field" style={fieldStyle}>
                    <span style={labelStyle}>代填人 / 会员名</span>
                    <input
                      className="fahui-intake__input"
                      style={inputStyle}
                      value={orderForm.memberName}
                      placeholder="可选"
                      onChange={(event) => setOrderForm((current) => ({ ...current, memberName: event.target.value }))}
                    />
                  </label>

                  <label className="fahui-intake__field" style={fieldStyle}>
                    <span style={labelStyle}>Email</span>
                    <input
                      className="fahui-intake__input"
                      style={inputStyle}
                      value={orderForm.email}
                      placeholder="可选"
                      onChange={(event) => setOrderForm((current) => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                </>
              ) : null}
            </div>

            {mode === "existing" ? (
              <div className="fahui-intake__lookup" style={lookupPanelStyle}>
                <div className="fahui-intake__lookup-actions" style={toolbarStyle(isMobile)}>
                  <button
                    type="button"
                    className="fahui-intake__button fahui-intake__button--secondary"
                    style={secondaryButtonStyle}
                    onClick={() => void handleLookupOrders()}
                    disabled={lookupLoading}
                  >
                    {lookupLoading ? "读取中…" : "按手机号读取已有订单"}
                  </button>
                  <div className="fahui-intake__inline-note" style={inlineNoteStyle}>
                    选中一张订单后，下面新增的牌位会直接写进该订单。
                  </div>
                </div>

                <div className="fahui-intake__order-list" style={listStyle}>
                  {existingOrders.length ? (
                    existingOrders.map((order) => (
                      <article
                        key={order.id}
                        className="fahui-intake__order-card"
                        style={orderCardStyle(selectedOrderId === order.id)}
                      >
                        <div>
                          <div style={orderTitleStyle}>{order.customer_name || order.name || `订单 #${order.id}`}</div>
                          <div style={orderMetaStyle}>
                            订单 #{order.id} · {order.version || "-"} · {order.phone || "-"} · {order.created_at || "-"}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="fahui-intake__button fahui-intake__button--ghost"
                          style={ghostButtonStyle}
                          onClick={() => void loadOrderDetail(order.id)}
                        >
                          {selectedOrderId === order.id ? "当前订单" : "选择这张订单"}
                        </button>
                      </article>
                    ))
                  ) : (
                    <div className="fahui-intake__empty" style={emptyStyle}>
                      还没有读取到订单。先填手机号，再点“按手机号读取已有订单”。
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {selectedOrderDetail ? (
              <section className="fahui-intake__selected-order" style={selectedOrderPanelStyle}>
                <div style={sectionHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>当前订单</div>
                    <div style={sectionCopyStyle}>
                      订单 #{selectedOrderDetail.id} · {selectedOrderDetail.customer_name || selectedOrderDetail.name || "-"} ·{" "}
                      {selectedOrderDetail.phone || "-"}
                    </div>
                  </div>
                  {orderDetailLoading ? <div style={inlineNoteStyle}>刷新中…</div> : null}
                </div>

                <div className="fahui-intake__item-list" style={selectedItemsStyle}>
                  {(selectedOrderDetail.order_items || []).length ? (
                    (selectedOrderDetail.order_items || []).map((item) => (
                      <article key={item.id} className="fahui-intake__selected-item" style={selectedItemCardStyle}>
                        <div style={selectedItemTitleStyle}>
                          {item.item_name || item.code || "未命名项目"} <span style={selectedItemMetaStyle}>· RM {item.price || 0}</span>
                        </div>
                        <div style={selectedItemSummaryStyle}>{summarizeItem(item) || "这笔项目目前没有展开字段摘要。"}</div>
                      </article>
                    ))
                  ) : (
                    <div className="fahui-intake__empty" style={emptyStyle}>
                      这张订单目前还没有项目，你可以直接在下面新增第一批牌位。
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            <section className="fahui-intake__draft-section" style={draftSectionStyle}>
              <div style={sectionHeaderStyle}>
                <div>
                  <div style={sectionTitleStyle}>牌位项目</div>
                  <div style={sectionCopyStyle}>
                    每张卡片对应一笔 `order_items` 记录，下面填写的字段会原样落到 `item_form_data`。
                  </div>
                </div>
                <div className="fahui-intake__summary-pill" style={summaryPillStyle}>
                  本次合计 RM {selectedTemplateTotals.toFixed(2)}
                </div>
              </div>

              <div className="fahui-intake__template-grid" style={templateGridStyle(isMobile)}>
                {PAIWEI_TEMPLATES.map((template) => (
                  <button
                    key={template.code}
                    type="button"
                    className="fahui-intake__template-card"
                    style={templateCardStyle}
                    onClick={() => addDraft(template.code)}
                    title={template.hint}
                  >
                    <div style={templateCodeStyle}>{template.code}</div>
                    <div style={templateTitleStyle}>{template.title}</div>
                    <div style={templateMetaStyle}>RM {template.price}</div>
                  </button>
                ))}
              </div>

              <div className="fahui-intake__draft-list" style={listStyle}>
                {drafts.map((draft, index) => {
                  const template = getTemplate(draft.code);
                  return (
                    <article key={draft.id} className="fahui-intake__draft-card" style={draftCardStyle}>
                      <div style={draftHeaderStyle(isMobile)}>
                        <div>
                          <div style={orderTitleStyle}>
                            第 {index + 1} 项 · {template.title}
                          </div>
                          <div style={orderMetaStyle}>{template.hint}</div>
                        </div>
                        <button
                          type="button"
                          className="fahui-intake__button fahui-intake__button--ghost-danger"
                          style={ghostDangerButtonStyle}
                          onClick={() => removeDraft(index)}
                        >
                          移除
                        </button>
                      </div>

                      <div className="fahui-intake__field-grid" style={fieldGridStyle(isMobile)}>
                        <label className="fahui-intake__field" style={fieldStyle}>
                          <span style={labelStyle}>牌位类型</span>
                          <select
                            className="fahui-intake__select"
                            style={inputStyle}
                            value={draft.code}
                            onChange={(event) => handleChangeDraftCode(index, event.target.value as PaiweiCode)}
                          >
                            {PAIWEI_TEMPLATES.map((item) => (
                              <option key={item.code} value={item.code}>
                                {item.code} · {item.title}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="fahui-intake__field" style={fieldStyle}>
                          <span style={labelStyle}>项目名称</span>
                          <input
                            className="fahui-intake__input"
                            style={inputStyle}
                            value={draft.itemName}
                            onChange={(event) => updateDraft(index, { itemName: event.target.value })}
                          />
                        </label>

                        <label className="fahui-intake__field" style={fieldStyle}>
                          <span style={labelStyle}>金额</span>
                          <input
                            className="fahui-intake__input"
                            style={inputStyle}
                            value={draft.price}
                            onChange={(event) => updateDraft(index, { price: event.target.value })}
                          />
                        </label>

                        {template.fields.quantity ? (
                          <label className="fahui-intake__field" style={fieldStyle}>
                            <span style={labelStyle}>数量</span>
                            <input
                              className="fahui-intake__input"
                              style={inputStyle}
                              value={draft.quantity}
                              onChange={(event) => updateDraft(index, { quantity: event.target.value })}
                            />
                          </label>
                        ) : null}

                        {template.fields.surname ? (
                          <label className="fahui-intake__field" style={fieldStyle}>
                            <span style={labelStyle}>姓氏</span>
                            <input
                              className="fahui-intake__input"
                              style={inputStyle}
                              value={draft.surname}
                              onChange={(event) => updateDraft(index, { surname: event.target.value })}
                            />
                          </label>
                        ) : null}

                        {template.fields.suffix ? (
                          <label className="fahui-intake__field" style={fieldStyle}>
                            <span style={labelStyle}>堂号 / 后缀</span>
                            <input
                              className="fahui-intake__input"
                              style={inputStyle}
                              value={draft.suffix}
                              onChange={(event) => updateDraft(index, { suffix: event.target.value })}
                            />
                          </label>
                        ) : null}

                        {template.fields.father ? (
                          <label className="fahui-intake__field" style={fieldStyle}>
                            <span style={labelStyle}>父名</span>
                            <input
                              className="fahui-intake__input"
                              style={inputStyle}
                              value={draft.father}
                              onChange={(event) => updateDraft(index, { father: event.target.value })}
                            />
                          </label>
                        ) : null}

                        {template.fields.mother ? (
                          <label className="fahui-intake__field" style={fieldStyle}>
                            <span style={labelStyle}>母名</span>
                            <input
                              className="fahui-intake__input"
                              style={inputStyle}
                              value={draft.mother}
                              onChange={(event) => updateDraft(index, { mother: event.target.value })}
                            />
                          </label>
                        ) : null}
                      </div>

                      {template.fields.owner ? (
                        <label className="fahui-intake__field" style={fieldStyle}>
                          <span style={labelStyle}>阳上</span>
                          <textarea
                            className="fahui-intake__textarea"
                            style={textareaStyle}
                            value={draft.owner}
                            placeholder="一行一个姓名；若有多个阳上，系统会当成数组写入 owner"
                            onChange={(event) => updateDraft(index, { owner: event.target.value })}
                          />
                        </label>
                      ) : null}

                      {template.fields.deceased ? (
                        <label className="fahui-intake__field" style={fieldStyle}>
                          <span style={labelStyle}>亡者 / 对象</span>
                          <textarea
                            className="fahui-intake__textarea"
                            style={textareaStyle}
                            value={draft.deceased}
                            placeholder="一行一个姓名；A2 / B2 会要求这一栏必填"
                            onChange={(event) => updateDraft(index, { deceased: event.target.value })}
                          />
                        </label>
                      ) : null}

                      {template.fields.relation ? (
                        <label className="fahui-intake__field" style={fieldStyle}>
                          <span style={labelStyle}>关系</span>
                          <textarea
                            className="fahui-intake__textarea"
                            style={textareaStyle}
                            value={draft.relation}
                            placeholder="一行对应一位亡者，例如：显考 / 显妣 / 祖考 / 祖妣"
                            onChange={(event) => updateDraft(index, { relation: event.target.value })}
                          />
                        </label>
                      ) : null}

                      <label className="fahui-intake__field" style={fieldStyle}>
                        <span style={labelStyle}>备注 / 附加字段</span>
                        <textarea
                          className="fahui-intake__textarea"
                          style={textareaStyle}
                          value={draft.note}
                          placeholder="如果现有结构里还想带一个 note，也可以从这里一并写进去"
                          onChange={(event) => updateDraft(index, { note: event.target.value })}
                        />
                      </label>
                    </article>
                  );
                })}
              </div>
            </section>

            <div className="fahui-intake__action-row" style={actionRowStyle(isMobile)}>
              <button
                type="button"
                className="fahui-intake__button fahui-intake__button--secondary"
                style={secondaryButtonStyle}
                onClick={() => addDraft()}
              >
                再加一项
              </button>
              <button className="fahui-intake__button fahui-intake__button--primary" type="submit" style={primaryButtonStyle} disabled={submitting}>
                {submitting ? "提交中…" : mode === "new" ? "创建订单并写入牌位" : "写入当前订单"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "32px 20px 56px",
  background:
    "radial-gradient(circle at top left, rgba(196,148,88,0.18), transparent 32%), linear-gradient(180deg, #f8f3ea 0%, #efe4d2 100%)",
};

function shellStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: "1120px",
    margin: "0 auto",
    display: "grid",
    gap: isMobile ? "18px" : "24px",
  };
}

const heroStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "28px",
  borderRadius: "24px",
  border: "1px solid rgba(126, 80, 32, 0.16)",
  background: "linear-gradient(135deg, rgba(255,250,242,0.98), rgba(247,236,220,0.94))",
  boxShadow: "0 18px 48px rgba(86, 52, 22, 0.12)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#7f5b37",
  fontWeight: 700,
};

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "28px" : "40px",
    lineHeight: 1.1,
    color: "#3a2410",
    fontWeight: 800,
  };
}

const leadStyle: CSSProperties = {
  fontSize: "15px",
  lineHeight: 1.7,
  color: "#71553a",
  maxWidth: "760px",
};

const badgeRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const badgeStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(122, 84, 46, 0.08)",
  color: "#6b4c2f",
  fontSize: "12px",
  fontWeight: 700,
};

const panelStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  padding: "24px",
  borderRadius: "24px",
  background: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(126, 80, 32, 0.12)",
  boxShadow: "0 14px 36px rgba(77, 49, 22, 0.08)",
};

function modeRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 220px))",
    gap: "10px",
  };
}

function modeButtonStyle(active: boolean): CSSProperties {
  return {
    padding: "14px 16px",
    borderRadius: "16px",
    border: active ? "1px solid #a66a2e" : "1px solid rgba(123, 90, 56, 0.18)",
    background: active ? "linear-gradient(135deg, #b87333, #8c5424)" : "rgba(255,255,255,0.92)",
    color: active ? "#fff8ef" : "#5f452d",
    cursor: "pointer",
    textAlign: "left",
    fontSize: "14px",
    fontWeight: 700,
  };
}

const formStyle: CSSProperties = {
  display: "grid",
  gap: "20px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: "12px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#3f2a16",
};

const sectionCopyStyle: CSSProperties = {
  marginTop: "4px",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
};

function fieldGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "14px",
  };
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#5d462f",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: "14px",
  border: "1px solid rgba(123, 90, 56, 0.18)",
  background: "#fffdfa",
  padding: "12px 14px",
  fontSize: "14px",
  color: "#342112",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "96px",
  resize: "vertical",
};

const lookupPanelStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "rgba(246,239,229,0.7)",
};

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: isMobile ? "stretch" : "center",
    gap: "10px",
  };
}

const inlineNoteStyle: CSSProperties = {
  fontSize: "13px",
  color: "#7a5e42",
  lineHeight: 1.5,
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

function orderCardStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    gap: "16px",
    padding: "16px",
    borderRadius: "16px",
    border: active ? "1px solid rgba(166,106,46,0.46)" : "1px solid rgba(123, 90, 56, 0.12)",
    background: active ? "rgba(255,248,237,0.96)" : "#fffdfa",
  };
}

const orderTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  color: "#3a2410",
};

const orderMetaStyle: CSSProperties = {
  marginTop: "4px",
  color: "#7a5e42",
  fontSize: "12px",
  lineHeight: 1.5,
};

const selectedOrderPanelStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "rgba(255,250,244,0.86)",
};

const selectedItemsStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const selectedItemCardStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
};

const selectedItemTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#3a2410",
};

const selectedItemMetaStyle: CSSProperties = {
  color: "#8a653f",
  fontWeight: 600,
};

const selectedItemSummaryStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "12px",
  color: "#6f553a",
  lineHeight: 1.6,
};

const draftSectionStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const summaryPillStyle: CSSProperties = {
  alignSelf: "start",
  padding: "10px 14px",
  borderRadius: "999px",
  background: "rgba(166,106,46,0.08)",
  color: "#6f4d2e",
  fontSize: "13px",
  fontWeight: 800,
};

function templateGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
    gap: "12px",
  };
}

const templateCardStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "14px",
  borderRadius: "16px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
  cursor: "pointer",
  textAlign: "left",
};

const templateCodeStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  color: "#a66a2e",
};

const templateTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#3a2410",
  lineHeight: 1.5,
};

const templateMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "#7a5e42",
};

const draftCardStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
};

function draftHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "start" : "center",
    gap: "12px",
    flexDirection: isMobile ? "column" : "row",
  };
}

function actionRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexDirection: isMobile ? "column" : "row",
    gap: "12px",
  };
}

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #ba7330, #8f5624)",
  color: "#fff8ef",
  padding: "12px 18px",
  fontSize: "14px",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(123, 90, 56, 0.18)",
  borderRadius: "14px",
  background: "#fffdfa",
  color: "#5c442c",
  padding: "12px 18px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid rgba(166,106,46,0.18)",
  borderRadius: "12px",
  background: "rgba(255,248,237,0.92)",
  color: "#8f5624",
  padding: "10px 12px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostDangerButtonStyle: CSSProperties = {
  border: "1px solid rgba(176, 63, 42, 0.18)",
  borderRadius: "12px",
  background: "rgba(255,244,241,0.96)",
  color: "#ad3e2a",
  padding: "10px 12px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const emptyStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "14px",
  border: "1px dashed rgba(123, 90, 56, 0.22)",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
  background: "rgba(250,246,239,0.75)",
};

const errorBannerStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(176, 63, 42, 0.18)",
  background: "rgba(255,243,240,0.96)",
  color: "#ad3e2a",
  fontSize: "14px",
  fontWeight: 700,
};

const successBannerStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(71, 120, 82, 0.18)",
  background: "rgba(241, 250, 244, 0.96)",
  color: "#336b42",
  fontSize: "14px",
  fontWeight: 700,
};
