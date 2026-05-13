import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

import { useUserState } from "../../../app/UserState";
import {
  clearVerifiedPhone,
  formatPhoneForInput,
  get_phone_on_localhost,
  getSavedVerifiedPhone,
} from "../../../js/get_phone_on_localhost";
import { correctPhoneInputMY } from "../../../js/phone";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import {
  createYlpOrder,
  createYlpOrderItem,
  deleteYlpOrderItem,
  fetchYlpOrderDetail,
  fetchYlpOrdersByPhone,
  updateYlpOrderCustomer,
} from "../api";
import type { YlpOrderDetail, YlpOrderItem, YlpOrderSummary } from "../types";
import { PaiweiDraftEditor } from "./PaiweiDraftEditor";
import {
  DEFAULT_VERSION,
  buildItemPayload,
  createDraft,
  emptyOrderForm,
  getDraftQuantity,
  getDraftTotalPrice,
  getTemplate,
  normalizePhoneMY,
  summarizeItem,
  validateDraft,
  type OrderFormState,
  type PaiweiCode,
  type PaiweiDraft,
} from "./paiwei";

type IntakeStep = "order" | "history" | "items";
type ItemFlowStep = "order_info" | "drafts" | "saved" | "confirm";

type OrderHistoryEntry = {
  summary: YlpOrderSummary;
  detail: YlpOrderDetail | null;
};

const PAIWEI_CODES: PaiweiCode[] = ["A1", "A2", "A3", "B1", "B2", "B3", "C", "D1"];

function summarizeDraft(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  const parts: string[] = [];
  if (draft.owner.trim()) {
    parts.push(`阳上：${draft.owner.trim().split(/\r?\n/)[0]}`);
  }
  if (draft.deceased.trim()) {
    parts.push(`对象：${draft.deceased.trim().split(/\r?\n/)[0]}`);
  }
  if (template.fields.quantity) {
    parts.push(`数量：${getDraftQuantity(draft)}`);
  }
  return parts.join(" · ");
}

function getContactName(form: OrderFormState) {
  return form.contactName.trim() || form.customerName.trim();
}

function scrollPageTop() {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function isLockedOrderStatus(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "approved" || normalized === "paid";
}

function getOrderStatusLabel(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "paid") {
    return "已付款";
  }
  if (normalized === "pending") {
    return "付款审核中";
  }
  if (normalized === "ready" || normalized === "process") {
    return "处理中";
  }
  return "未付款";
}

function getOrderStatusTone(status: string | null | undefined) {
  if (isLockedOrderStatus(status)) {
    return {
      background: "rgba(45, 126, 76, 0.14)",
      border: "1px solid rgba(45, 126, 76, 0.28)",
      color: "#23603a",
    };
  }

  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pending") {
    return {
      background: "rgba(201, 137, 34, 0.12)",
      border: "1px solid rgba(201, 137, 34, 0.24)",
      color: "#8a5a10",
    };
  }

  return {
    background: "rgba(122, 84, 46, 0.08)",
    border: "1px solid rgba(122, 84, 46, 0.16)",
    color: "#6b4c2f",
  };
}

function pickFirstValue(item: YlpOrderItem, fieldName: string) {
  const values = item.item_form_data?.[fieldName] || [];
  return String(values[0]?.val || "").trim();
}

function pickJoinedValues(item: YlpOrderItem, fieldName: string) {
  const values = item.item_form_data?.[fieldName] || [];
  return values
    .map((entry) => String(entry.val || "").trim())
    .filter(Boolean)
    .join("\n");
}

function coercePaiweiCode(item: YlpOrderItem): PaiweiCode {
  const raw = String(item.code || pickFirstValue(item, "form-group") || "").trim().toUpperCase();
  if (raw === "D") {
    return "D1";
  }
  return PAIWEI_CODES.includes(raw as PaiweiCode) ? (raw as PaiweiCode) : "A1";
}

function draftFromOrderItem(item: YlpOrderItem) {
  const code = coercePaiweiCode(item);
  const base = createDraft(code);
  const template = getTemplate(code);

  return {
    ...base,
    code,
    owner: template.fields.owner ? pickJoinedValues(item, "owner") : "",
    deceased: template.fields.deceased ? pickJoinedValues(item, "deceased") : "",
    relation: template.fields.relation ? pickJoinedValues(item, "relation") : "",
    surname: template.fields.surname ? pickFirstValue(item, "surname") : "",
    suffix: template.fields.suffix ? pickFirstValue(item, "suffix") || base.suffix : "",
    father: template.fields.father ? pickFirstValue(item, "father") : "",
    mother: template.fields.mother ? pickFirstValue(item, "mother") : "",
    quantity: template.fields.quantity ? pickFirstValue(item, "quantity") || "1" : "",
    note: pickFirstValue(item, "note"),
  };
}

function draftsFromOrderDetail(detail: YlpOrderDetail | null) {
  const items = detail?.order_items || [];
  const mapped = items.map(draftFromOrderItem);
  return mapped.length ? mapped : [createDraft()];
}

function getOrderPreviewLines(detail: YlpOrderDetail | null) {
  return (detail?.order_items || [])
    .slice(0, 3)
    .map((item) => summarizeItem(item) || item.item_name || item.code || "未命名牌位")
    .filter(Boolean);
}

function getItemCount(detail: YlpOrderDetail | null) {
  return (detail?.order_items || []).length;
}

export function FahuiIntakePage() {
  useEnsureDesignTokens();

  const { isAuthenticated, isMobile } = useUserState();
  const [currentStep, setCurrentStep] = useState<IntakeStep>("order");
  const [itemFlowStep, setItemFlowStep] = useState<ItemFlowStep>("order_info");
  const [orderForm, setOrderForm] = useState<OrderFormState>(() => emptyOrderForm());
  const [drafts, setDrafts] = useState<PaiweiDraft[]>(() => []);
  const [currentDraftIndex, setCurrentDraftIndex] = useState<number | null>(null);
  const [historyEntries, setHistoryEntries] = useState<OrderHistoryEntry[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [loadedSourceOrderId, setLoadedSourceOrderId] = useState<number | null>(null);
  const [loadedSourceVersion, setLoadedSourceVersion] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [entryLoadingId, setEntryLoadingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const totalAmount = useMemo(
    () => drafts.reduce((sum, draft) => sum + getDraftTotalPrice(draft), 0),
    [drafts],
  );

  const currentYearEntries = useMemo(
    () => historyEntries.filter((entry) => String(entry.summary.version || "") === DEFAULT_VERSION),
    [historyEntries],
  );
  const legacyEntries = useMemo(
    () =>
      historyEntries.filter(
        (entry) => String(entry.summary.version || "") !== DEFAULT_VERSION && String(entry.summary.version || "") !== "DELETE",
      ),
    [historyEntries],
  );
  const currentEditableEntry = useMemo(
    () => currentYearEntries.find((entry) => !isLockedOrderStatus(entry.summary.status)),
    [currentYearEntries],
  );
  const hasLockedCurrentYear = useMemo(
    () => currentYearEntries.some((entry) => isLockedOrderStatus(entry.summary.status)),
    [currentYearEntries],
  );
  const legacyCopyDisabled = hasLockedCurrentYear && !currentEditableEntry;
  const currentYearLabel = DEFAULT_VERSION.replace("_YLP", "");

  useEffect(() => {
    const savedPhone = getSavedVerifiedPhone();
    if (savedPhone) {
      setOrderForm((current) => ({ ...current, phone: current.phone || formatPhoneForInput(savedPhone) }));
    }
  }, []);

  useEffect(() => {
    setCurrentDraftIndex((current) => {
      if (!drafts.length) {
        return null;
      }
      if (current == null) {
        return null;
      }
      return Math.min(current, Math.max(0, drafts.length - 1));
    });
  }, [drafts.length]);

  async function ensurePhoneAccess(rawPhone: string) {
    const normalizedPhone = normalizePhoneMY(rawPhone);
    if (!normalizedPhone) {
      throw new Error("请填写正确的马来西亚手机号码");
    }

    if (isAuthenticated) {
      return normalizedPhone;
    }

    const savedPhone = getSavedVerifiedPhone(normalizedPhone);
    if (savedPhone) {
      return savedPhone;
    }

    clearVerifiedPhone();
    const verifiedPhone = normalizePhoneMY(await get_phone_on_localhost(normalizedPhone));
    if (!verifiedPhone || verifiedPhone !== normalizedPhone) {
      throw new Error("请使用订单手机号完成验证后再继续");
    }

    return verifiedPhone;
  }

  function consumeAccessError(nextError: unknown) {
    const text = nextError instanceof Error ? nextError.message : "请求失败";
    if (!isAuthenticated && /(手机验证|没有权限|未登录)/.test(text)) {
      clearVerifiedPhone();
    }
    return text;
  }

  function validatePhoneOnly(form: OrderFormState) {
    if (!normalizePhoneMY(form.phone)) {
      return "请填写正确的马来西亚手机号码";
    }
    return null;
  }

  function validateOrderFormState(form: OrderFormState) {
    const phoneValidationError = validatePhoneOnly(form);
    if (phoneValidationError) {
      return phoneValidationError;
    }
    if (!form.customerName.trim()) {
      return "请填写功德主姓名";
    }
    return null;
  }

  async function loadOrdersByPhone(verifiedPhone: string) {
    const payload = await fetchYlpOrdersByPhone(verifiedPhone);
    const items = (payload.data?.items || []).filter((item) => String(item.version || "") !== "DELETE");
    if (!items.length) {
      return [] as OrderHistoryEntry[];
    }

    return Promise.all(
      items.map(async (summary) => {
        try {
          const detailPayload = await fetchYlpOrderDetail(summary.id);
          return {
            summary,
            detail: detailPayload.data || null,
          };
        } catch {
          return {
            summary,
            detail: null,
          };
        }
      }),
    );
  }

  async function handleContinueToHistory() {
    setError("");
    setMessage("");

    const validationError = validatePhoneOnly(orderForm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setAdvancing(true);
    setHistoryLoading(true);
    try {
      const verifiedPhone = await ensurePhoneAccess(orderForm.phone);
      const nextEntries = await loadOrdersByPhone(verifiedPhone);
      setOrderForm((current) => ({
        ...current,
        phone: formatPhoneForInput(verifiedPhone),
      }));
      setHistoryEntries(nextEntries);

      if (nextEntries.length) {
        setCurrentStep("history");
      } else {
        setDrafts([]);
        setCurrentDraftIndex(null);
        setActiveOrderId(null);
        setLoadedSourceOrderId(null);
        setLoadedSourceVersion(null);
        setEditorNotice("没有查到历史资料，直接开始填写今年的牌位内容。");
        setItemFlowStep("order_info");
        setCurrentStep("items");
      }
      scrollPageTop();
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setAdvancing(false);
      setHistoryLoading(false);
    }
  }

  function updateDraft(index: number, patch: Partial<PaiweiDraft>) {
    setDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)),
    );
  }

  function handleChangeDraftCode(index: number, code: PaiweiCode) {
    const template = getTemplate(code);
    setDrafts((current) =>
      current.map((draft, draftIndex) => {
        if (draftIndex !== index) {
          return draft;
        }
        return {
          ...draft,
          code,
          owner: template.fields.owner ? draft.owner : "",
          deceased: template.fields.deceased ? draft.deceased : "",
          surname: template.fields.surname ? draft.surname : "",
          suffix: template.fields.suffix ? draft.suffix || template.defaultSuffix || "" : "",
          father: template.fields.father ? draft.father : "",
          mother: template.fields.mother ? draft.mother : "",
          relation: template.fields.relation ? draft.relation : "",
          quantity: template.fields.quantity ? draft.quantity || "1" : "",
        };
      }),
    );
  }

  function addDraft(code: PaiweiCode) {
    setDrafts((current) => {
      const next = [...current, createDraft(code)];
      setCurrentDraftIndex(next.length - 1);
      return next;
    });
  }

  function removeDraft(index: number) {
    setDrafts((current) => {
      if (current.length <= 1) {
        setCurrentDraftIndex(null);
        return [];
      }
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      setCurrentDraftIndex((currentIndex) => {
        if (currentIndex == null) {
          return null;
        }
        if (currentIndex > index) {
          return currentIndex - 1;
        }
        return Math.min(currentIndex, next.length - 1);
      });
      return next;
    });
  }

  function closeDraftEditor() {
    setCurrentDraftIndex(null);
  }

  async function openEntryForEditing(entry: OrderHistoryEntry, source: "current" | "legacy") {
    setError("");
    setMessage("");
    setEntryLoadingId(entry.summary.id);

    try {
      const detail = entry.detail || (await fetchYlpOrderDetail(entry.summary.id)).data || null;
      const nextDrafts = draftsFromOrderDetail(detail);

      setDrafts(nextDrafts);
      setCurrentDraftIndex(nextDrafts.length ? 0 : null);
      setLoadedSourceOrderId(detail?.id || entry.summary.id);
      setLoadedSourceVersion(detail?.version || entry.summary.version || null);
      setOrderForm((current) => ({
        ...current,
        customerName: detail?.customer_name || entry.summary.customer_name || current.customerName,
        contactName: detail?.name || entry.summary.name || entry.summary.customer_name || current.contactName,
        email: detail?.email || entry.summary.email || current.email,
        phone: formatPhoneForInput(detail?.phone || entry.summary.phone || current.phone),
      }));

      if (source === "current") {
        setActiveOrderId(entry.summary.id);
        setEditorNotice(`正在编辑 ${currentYearLabel} 年未付款资料，提交时会更新这张订单。`);
      } else {
        setActiveOrderId(currentEditableEntry?.summary.id || null);
        setEditorNotice(
          currentEditableEntry
            ? `已载入 ${entry.summary.version || "旧资料"}，提交时会覆盖 ${currentYearLabel} 年未付款订单。`
            : `已载入 ${entry.summary.version || "旧资料"}，提交时会复制成 ${currentYearLabel} 年的新订单。`,
        );
      }

      setItemFlowStep("order_info");
      setCurrentStep("items");
      scrollPageTop();
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setEntryLoadingId(null);
    }
  }

  function startFreshCurrentYear() {
    setError("");
    setMessage("");
    setDrafts([]);
    setCurrentDraftIndex(null);
    setLoadedSourceOrderId(null);
    setLoadedSourceVersion(null);
    setActiveOrderId(null);
    setEditorNotice(`正在填写 ${currentYearLabel} 年的新牌位资料。`);
    setItemFlowStep("order_info");
    setCurrentStep("items");
    scrollPageTop();
  }

  function handleContinueToItemDrafts() {
    setError("");
    const orderValidationError = validateOrderFormState(orderForm);
    if (orderValidationError) {
      setError(orderValidationError);
      return;
    }
    setItemFlowStep("drafts");
    scrollPageTop();
  }

  function handleContinueToItemConfirm() {
    setError("");

    if (!drafts.length) {
      setError("请先添加至少一项牌位");
      return;
    }

    for (const draft of drafts) {
      const validationError = validateDraft(draft);
      if (validationError) {
        setError(validationError);
        setCurrentDraftIndex(drafts.findIndex((item) => item.id === draft.id));
        return;
      }
    }

    setCurrentDraftIndex(null);
    setItemFlowStep("saved");
    scrollPageTop();
  }

  function handleContinueToSubmitConfirm() {
    setError("");
    setItemFlowStep("confirm");
    scrollPageTop();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const orderValidationError = validateOrderFormState(orderForm);
    if (orderValidationError) {
      setCurrentStep("items");
      setItemFlowStep("order_info");
      setError(orderValidationError);
      scrollPageTop();
      return;
    }

    if (!drafts.length) {
      setError("请先添加至少一项牌位");
      return;
    }

    for (const draft of drafts) {
      const validationError = validateDraft(draft);
      if (validationError) {
        setError(validationError);
        setItemFlowStep("drafts");
        setCurrentDraftIndex(drafts.findIndex((item) => item.id === draft.id));
        scrollPageTop();
        return;
      }
    }

    setSubmitting(true);
    try {
      const verifiedPhone = await ensurePhoneAccess(orderForm.phone);
      const customerName = orderForm.customerName.trim() || undefined;
      const contactName = getContactName(orderForm);
      const email = orderForm.email.trim() || undefined;

      let orderId = activeOrderId;
      let replaceExistingItems = Boolean(activeOrderId);

      if (!orderId) {
        const createPayload = await createYlpOrder({
          name: contactName,
          customer_name: customerName,
          phone: verifiedPhone,
          email,
        });

        orderId = createPayload.order?.id || null;
        if (!orderId) {
          throw new Error(createPayload.message || "创建订单失败");
        }

        if (createPayload.duplicated) {
          if (isLockedOrderStatus(createPayload.order?.status)) {
            throw new Error(`${currentYearLabel} 年资料已经付款，不能再修改。`);
          }
          replaceExistingItems = true;
        }
      }

      await updateYlpOrderCustomer(orderId, {
        customer_name: customerName,
        email,
        phone: verifiedPhone,
      });

      if (replaceExistingItems) {
        const existingDetail = await fetchYlpOrderDetail(orderId);
        for (const item of existingDetail.data?.order_items || []) {
          await deleteYlpOrderItem(orderId, item.id);
        }
      }

      for (let index = 0; index < drafts.length; index += 1) {
        const payload = buildItemPayload(drafts[index]);
        const result = await createYlpOrderItem(orderId, payload);
        if (!result.success) {
          throw new Error(result.message || `第 ${index + 1} 项保存失败`);
        }
      }

      const refreshedEntries = await loadOrdersByPhone(verifiedPhone);
      setHistoryEntries(refreshedEntries);
      setOrderForm((current) => ({
        ...current,
        phone: formatPhoneForInput(verifiedPhone),
      }));
      setDrafts([]);
      setCurrentDraftIndex(null);
      setActiveOrderId(orderId);
      setLoadedSourceOrderId(orderId);
      setLoadedSourceVersion(DEFAULT_VERSION);
      setEditorNotice("");
      setCurrentStep("history");
      setMessage(`已保存到 ${currentYearLabel} 年订单 #${orderId}，共登记 ${drafts.length} 项。`);
      scrollPageTop();
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  const orderSummary = [
    { label: "功德主姓名", value: orderForm.customerName.trim() || "-" },
    { label: "联络人姓名", value: getContactName(orderForm) || "-" },
    { label: "手机号码", value: formatPhoneForInput(orderForm.phone) || orderForm.phone.trim() || "-" },
    { label: "电子邮箱", value: orderForm.email.trim() || "未填写" },
  ];

  const itemStepSubmitLabel = activeOrderId
    ? `更新 ${currentYearLabel} 年订单`
    : loadedSourceVersion && loadedSourceVersion !== DEFAULT_VERSION
      ? `复制到 ${currentYearLabel} 并提交`
      : "建立订单并提交";

  const itemStepSubmitNote = activeOrderId
    ? "提交后会覆盖当前未付款订单的牌位内容。"
    : loadedSourceVersion && loadedSourceVersion !== DEFAULT_VERSION
      ? "提交后会把旧资料复制成今年的新订单，再进入付款流程。"
      : "提交后会建立今年的新订单。";

  return (
    <div className="fahui-intake__page" style={pageStyle}>
      <div className="fahui-intake__shell" style={shellStyle(isMobile)}>
        <section className="fahui-intake__hero" style={heroStyle}>
          <div style={stepRowStyle}>
            <span style={stepPillStyle(currentStep === "order")}>1. 订单资料</span>
            <span style={stepPillStyle(currentStep === "history")}>2. 历史资料</span>
            <span style={stepPillStyle(currentStep === "items")}>3. 牌位内容</span>
          </div>
          <h1 className="fahui-intake__title" style={titleStyle(isMobile)}>
            盂兰盆牌位填写
          </h1>
          <p className="fahui-intake__lead" style={leadStyle}>
            先确认订单资料，再查看这个手机号码的历史牌位资料；如果今年已有未付款资料，可直接继续编辑。
          </p>
        </section>

        <section className="fahui-intake__panel" style={panelStyle}>
          {error ? <div style={errorBannerStyle}>{error}</div> : null}
          {message ? <div style={successBannerStyle}>{message}</div> : null}

          {currentStep === "order" ? (
            <form
              className="fahui-intake__order-form"
              style={formStyle}
              onSubmit={(event) => {
                event.preventDefault();
                void handleContinueToHistory();
              }}
            >
              <section style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>订单资料</div>
                    <div style={sectionCopyStyle}>先填写手机号码。系统会优先读取这个手机号过去的牌位资料。</div>
                  </div>
                </div>

                <div style={singleFieldRowStyle}>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>手机号码</span>
                    <input
                      style={inputStyle}
                      value={orderForm.phone}
                      placeholder="例如 0123456789"
                      onChange={(event) =>
                        setOrderForm((current) => ({ ...current, phone: correctPhoneInputMY(event.target.value) }))
                      }
                      onBlur={() =>
                        setOrderForm((current) => ({ ...current, phone: formatPhoneForInput(current.phone) }))
                      }
                    />
                  </label>
                </div>

                <div style={actionRowStyle(isMobile)}>
                  <div style={actionNoteStyle}>
                    {isAuthenticated
                      ? "已登录会直接读取这个手机号的资料。"
                      : "未登录时，下一步会先验证这个手机号。"}
                  </div>
                  <button type="submit" style={primaryButtonStyle} disabled={advancing || historyLoading}>
                    {advancing || historyLoading ? "处理中…" : "下一步"}
                  </button>
                </div>
              </section>
            </form>
          ) : null}

          {currentStep === "history" ? (
            <section style={formStyle}>
              <section style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>这个手机号码的历史资料</div>
                    <div style={sectionCopyStyle}>
                      优先显示 {currentYearLabel} 年资料；如果找到旧资料，点击后会直接带到今年继续填写。
                    </div>
                  </div>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => {
                      setCurrentStep("order");
                      scrollPageTop();
                    }}
                  >
                    返回上一步
                  </button>
                </div>

                <div style={detailGridStyle(isMobile)}>
                  {orderSummary.map((item) => (
                    <article key={item.label} style={detailCardStyle}>
                      <div style={detailLabelStyle}>{item.label}</div>
                      <div style={detailValueStyle}>{item.value}</div>
                    </article>
                  ))}
                </div>

                {historyLoading ? <div style={emptyStyle}>正在整理这个手机号的历史资料…</div> : null}
              </section>

              <section style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>{currentYearLabel} 年资料</div>
                    <div style={sectionCopyStyle}>未付款的资料可以继续编辑；已付款的资料会锁定显示。</div>
                  </div>
                </div>

                <div style={historyListStyle}>
                  {currentYearEntries.length ? (
                    currentYearEntries.map((entry) => {
                      const locked = isLockedOrderStatus(entry.summary.status);
                      const previews = getOrderPreviewLines(entry.detail);
                      const count = getItemCount(entry.detail);

                      return (
                        <article key={entry.summary.id} style={historyCardStyle(locked)}>
                          <div style={historyCardHeaderStyle(isMobile)}>
                            <div>
                              <div style={historyTitleStyle}>
                                {entry.summary.customer_name || entry.summary.name || `订单 #${entry.summary.id}`}
                              </div>
                              <div style={historyMetaStyle}>
                                {entry.summary.version || "-"} · {entry.summary.created_at || "-"} · {count} 项
                              </div>
                            </div>
                            <span style={{ ...statusChipStyle, ...getOrderStatusTone(entry.summary.status) }}>
                              {getOrderStatusLabel(entry.summary.status)}
                            </span>
                          </div>

                          {previews.length ? (
                            <div style={previewListStyle}>
                              {previews.map((line, index) => (
                                <div key={`${entry.summary.id}-${index}`} style={previewItemStyle}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={emptyMiniStyle}>这张订单目前还没有牌位内容。</div>
                          )}

                          <div style={historyActionRowStyle(isMobile)}>
                            <div style={inlineNoteStyle}>
                              {locked ? "这张资料已经付款，保留为只读参考。" : "点击后会载入这张未付款资料继续编辑。"}
                            </div>
                            <button
                              type="button"
                              style={locked ? disabledSuccessButtonStyle : ghostButtonStyle}
                              disabled={locked || entryLoadingId === entry.summary.id}
                              onClick={() => void openEntryForEditing(entry, "current")}
                            >
                              {locked
                                ? "已付款"
                                : entryLoadingId === entry.summary.id
                                  ? "读取中…"
                                  : "继续编辑"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div style={emptyStyle}>今年还没有找到资料，你可以直接开始填写，或参考旧资料带入今年。</div>
                  )}
                </div>
              </section>

              <section style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>以前的资料</div>
                    <div style={sectionCopyStyle}>点击某一张旧资料，会把内容带到今年作为草稿继续编辑。</div>
                  </div>
                  {!currentYearEntries.length && !legacyCopyDisabled ? (
                    <button type="button" style={secondaryButtonStyle} onClick={startFreshCurrentYear}>
                      直接填写今年新资料
                    </button>
                  ) : null}
                </div>

                {legacyCopyDisabled ? (
                  <div style={lockedHintStyle}>
                    今年的资料已经付款，旧资料只能参考查看，不能再复制到今年继续修改。
                  </div>
                ) : null}

                <div style={historyListStyle}>
                  {legacyEntries.length ? (
                    legacyEntries.map((entry) => {
                      const previews = getOrderPreviewLines(entry.detail);
                      const count = getItemCount(entry.detail);

                      return (
                        <article key={entry.summary.id} style={historyCardStyle(false)}>
                          <div style={historyCardHeaderStyle(isMobile)}>
                            <div>
                              <div style={historyTitleStyle}>
                                {entry.summary.customer_name || entry.summary.name || `订单 #${entry.summary.id}`}
                              </div>
                              <div style={historyMetaStyle}>
                                {entry.summary.version || "-"} · {entry.summary.created_at || "-"} · {count} 项
                              </div>
                            </div>
                            <span style={{ ...statusChipStyle, ...getOrderStatusTone(entry.summary.status) }}>
                              {getOrderStatusLabel(entry.summary.status)}
                            </span>
                          </div>

                          {previews.length ? (
                            <div style={previewListStyle}>
                              {previews.map((line, index) => (
                                <div key={`${entry.summary.id}-${index}`} style={previewItemStyle}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={emptyMiniStyle}>这张旧资料没有可显示的牌位摘要。</div>
                          )}

                          <div style={historyActionRowStyle(isMobile)}>
                            <div style={inlineNoteStyle}>
                              {legacyCopyDisabled
                                ? "今年资料已付款，因此这张旧资料只能作为参考。"
                                : `点击后会把 ${entry.summary.version || "旧资料"} 带到 ${currentYearLabel} 年继续编辑。`}
                            </div>
                            <button
                              type="button"
                              style={legacyCopyDisabled ? disabledButtonStyle : ghostButtonStyle}
                              disabled={legacyCopyDisabled || entryLoadingId === entry.summary.id}
                              onClick={() => void openEntryForEditing(entry, "legacy")}
                            >
                              {entryLoadingId === entry.summary.id ? "读取中…" : `沿用到 ${currentYearLabel}`}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div style={emptyStyle}>没有找到以前的牌位资料。</div>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {currentStep === "items" ? (
            <form className="fahui-intake__item-form" style={formStyle} onSubmit={handleSubmit}>
              <section style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>填写步骤</div>
                    <div style={sectionCopyStyle}>依序完成今年订单资料、牌位内容，最后再做提交确认。</div>
                  </div>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => {
                      setCurrentStep(historyEntries.length ? "history" : "order");
                      setItemFlowStep("order_info");
                      scrollPageTop();
                    }}
                  >
                    {historyEntries.length ? "返回历史资料" : "返回上一步"}
                  </button>
                </div>

                <div style={itemFlowRowStyle}>
                  <span style={itemFlowPillStyle(itemFlowStep === "order_info")}>1. 今年订单资料</span>
                  <span style={itemFlowPillStyle(itemFlowStep === "drafts")}>2. 牌位内容</span>
                  <span style={itemFlowPillStyle(itemFlowStep === "saved")}>3. 已添加牌位</span>
                  <span style={itemFlowPillStyle(itemFlowStep === "confirm")}>4. 提交确认</span>
                </div>

                {editorNotice ? <div style={infoBannerStyle}>{editorNotice}</div> : null}
                {loadedSourceVersion ? (
                  <div style={sourceInfoStyle}>
                    来源资料：
                    {loadedSourceVersion}
                    {loadedSourceOrderId ? ` · 订单 #${loadedSourceOrderId}` : ""}
                  </div>
                ) : null}
              </section>

              {itemFlowStep === "order_info" ? (
                <section style={sectionCardStyle}>
                  <div style={sectionHeaderStyle}>
                    <div>
                      <div style={sectionTitleStyle}>今年订单资料</div>
                      <div style={sectionCopyStyle}>先补上今年这张订单的基本资料，再进入牌位填写。</div>
                    </div>
                  </div>

                  <div style={fieldGridStyle(isMobile)}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>手机号码</span>
                      <input
                        style={inputStyle}
                        value={orderForm.phone}
                        placeholder="例如 0123456789"
                        onChange={(event) =>
                          setOrderForm((current) => ({ ...current, phone: correctPhoneInputMY(event.target.value) }))
                        }
                        onBlur={() =>
                          setOrderForm((current) => ({ ...current, phone: formatPhoneForInput(current.phone) }))
                        }
                      />
                    </label>

                    <label style={fieldStyle}>
                      <span style={labelStyle}>功德主姓名</span>
                      <input
                        style={inputStyle}
                        value={orderForm.customerName}
                        placeholder="请填写功德主姓名"
                        onChange={(event) => setOrderForm((current) => ({ ...current, customerName: event.target.value }))}
                      />
                    </label>

                    <label style={fieldStyle}>
                      <span style={labelStyle}>联络人姓名</span>
                      <input
                        style={inputStyle}
                        value={orderForm.contactName}
                        placeholder="不填写时会自动沿用功德主姓名"
                        onChange={(event) => setOrderForm((current) => ({ ...current, contactName: event.target.value }))}
                      />
                    </label>

                    <label style={fieldStyle}>
                      <span style={labelStyle}>电子邮箱（选填）</span>
                      <input
                        style={inputStyle}
                        value={orderForm.email}
                        placeholder="可不填写"
                        onChange={(event) => setOrderForm((current) => ({ ...current, email: event.target.value }))}
                      />
                    </label>
                  </div>

                  <div style={actionRowStyle(isMobile)}>
                    <div style={actionNoteStyle}>确认这张订单资料后，再继续填写今年的牌位内容。</div>
                    <button type="button" style={primaryButtonStyle} onClick={handleContinueToItemDrafts}>
                      下一步：牌位内容
                    </button>
                  </div>
                </section>
              ) : null}

              {itemFlowStep === "drafts" ? (
                <>
                  <PaiweiDraftEditor
                    isMobile={isMobile}
                    drafts={drafts}
                    currentIndex={currentDraftIndex}
                    totalAmount={totalAmount}
                    showSavedList={false}
                    onSelectIndex={setCurrentDraftIndex}
                    onCloseEditor={closeDraftEditor}
                    onAddDraft={addDraft}
                    onRemoveDraft={removeDraft}
                    onUpdateDraft={updateDraft}
                    onChangeDraftCode={handleChangeDraftCode}
                  />

                  <section style={sectionCardStyle}>
                    <div style={actionRowStyle(isMobile)}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setItemFlowStep("order_info")}>
                        返回订单资料
                      </button>
                      <button type="button" style={primaryButtonStyle} onClick={handleContinueToItemConfirm}>
                        下一步：提交确认
                      </button>
                    </div>
                  </section>
                </>
              ) : null}

              {itemFlowStep === "saved" ? (
                <>
                  <section style={sectionCardStyle}>
                    <div style={sectionHeaderStyle}>
                      <div>
                        <div style={sectionTitleStyle}>已添加牌位</div>
                        <div style={sectionCopyStyle}>这一页会集中显示目前已保存的全部牌位，方便统一查看和修改。</div>
                      </div>
                      <div style={summaryPillStyle}>{`${drafts.length} 项 · RM ${totalAmount.toFixed(2)}`}</div>
                    </div>
                  </section>

                  <section style={sectionCardStyle}>
                    <div style={reviewListStyle}>
                      {drafts.map((draft, index) => {
                        const template = getTemplate(draft.code);
                        return (
                          <button
                            key={draft.id}
                            type="button"
                            style={reviewCardStyle}
                            onClick={() => {
                              setCurrentDraftIndex(index);
                              setItemFlowStep("drafts");
                              scrollPageTop();
                            }}
                          >
                            <div style={reviewTitleStyle}>
                              <span>{`第 ${index + 1} 项 · ${template.title}`}</span>
                              <span>{`RM ${getDraftTotalPrice(draft).toFixed(2)}`}</span>
                            </div>
                            <div style={reviewMetaStyle}>{summarizeDraft(draft) || "点击返回补充这项资料"}</div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section style={sectionCardStyle}>
                    <div style={actionRowStyle(isMobile)}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setItemFlowStep("drafts")}>
                        返回牌位内容
                      </button>
                      <button type="button" style={primaryButtonStyle} onClick={handleContinueToSubmitConfirm}>
                        下一步：提交确认
                      </button>
                    </div>
                  </section>
                </>
              ) : null}

              {itemFlowStep === "confirm" ? (
                <>
                  <section style={sectionCardStyle}>
                    <div style={sectionHeaderStyle}>
                      <div>
                        <div style={sectionTitleStyle}>提交确认</div>
                        <div style={sectionCopyStyle}>最后确认订单资料和总金额，没问题再提交。</div>
                      </div>
                      <div style={summaryPillStyle}>{`${drafts.length} 项 · RM ${totalAmount.toFixed(2)}`}</div>
                    </div>

                    <div style={detailGridStyle(isMobile)}>
                      {orderSummary.map((item) => (
                        <article key={item.label} style={detailCardStyle}>
                          <div style={detailLabelStyle}>{item.label}</div>
                          <div style={detailValueStyle}>{item.value}</div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section style={sectionCardStyle}>
                    <div style={actionRowStyle(isMobile)}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setItemFlowStep("saved")}>
                        返回已添加牌位
                      </button>
                      <div style={confirmActionGroupStyle(isMobile)}>
                        <div style={actionNoteStyle}>{itemStepSubmitNote}</div>
                        <button type="submit" style={primaryButtonStyle} disabled={submitting}>
                          {submitting ? "提交中…" : itemStepSubmitLabel}
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              ) : null}
            </form>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "12px",
  background: "#f8f3ea",
};

function shellStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: "1120px",
    margin: "0 auto",
    display: "grid",
    gap: "10px",
  };
}

const heroStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid rgba(126, 80, 32, 0.16)",
  background: "#fffaf2",
  boxShadow: "none",
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

function stepPillStyle(active: boolean): CSSProperties {
  return {
    padding: "5px 8px",
    borderRadius: "6px",
    background: active ? "#ba7330" : "rgba(122, 84, 46, 0.08)",
    color: active ? "#fff8ef" : "#6b4c2f",
    fontSize: "12px",
    fontWeight: 700,
  };
}

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "22px" : "28px",
    lineHeight: 1.08,
    color: "#3a2410",
    fontWeight: 800,
  };
}

const leadStyle: CSSProperties = {
  margin: 0,
  fontSize: "15px",
  lineHeight: 1.7,
  color: "#71553a",
  maxWidth: "760px",
};

const panelStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "10px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(126, 80, 32, 0.12)",
  boxShadow: "none",
};

const formStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const sectionCardStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid rgba(123, 90, 56, 0.1)",
  background: "rgba(255,252,247,0.92)",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: "12px",
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "#3f2a16",
};

const sectionCopyStyle: CSSProperties = {
  marginTop: "4px",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
};

const itemFlowRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
};

function itemFlowPillStyle(active: boolean): CSSProperties {
  return {
    padding: "6px 8px",
    borderRadius: "6px",
    background: active ? "#ba7330" : "rgba(122, 84, 46, 0.08)",
    color: active ? "#fff8ef" : "#6b4c2f",
    fontSize: "13px",
    fontWeight: 800,
  };
}

function fieldGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

const singleFieldRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "8px",
};

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
  borderRadius: "6px",
  border: "1px solid rgba(123, 90, 56, 0.18)",
  background: "#fffdfa",
  padding: "6px 8px",
  fontSize: "13px",
  color: "#342112",
};

function detailGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

const detailCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
};

const detailLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#8a653f",
};

const detailValueStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#3a2410",
  lineHeight: 1.5,
};

const historyListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

function historyCardStyle(locked: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "8px",
    padding: "10px",
    borderRadius: "6px",
    border: locked ? "1px solid rgba(45, 126, 76, 0.22)" : "1px solid rgba(123, 90, 56, 0.12)",
    background: locked ? "rgba(240, 251, 244, 0.96)" : "#fffdfa",
  };
}

function historyCardHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "start" : "center",
    flexDirection: isMobile ? "column" : "row",
    gap: "10px",
  };
}

const historyTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "#3a2410",
};

const historyMetaStyle: CSSProperties = {
  marginTop: "4px",
  color: "#7a5e42",
  fontSize: "12px",
  lineHeight: 1.5,
};

const statusChipStyle: CSSProperties = {
  padding: "4px 7px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
};

const previewListStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const previewItemStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "rgba(247,240,230,0.68)",
  color: "#5f452d",
  fontSize: "13px",
  lineHeight: 1.6,
};

function historyActionRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "center",
    flexDirection: isMobile ? "column" : "row",
    gap: "8px",
  };
}

const summaryPillStyle: CSSProperties = {
  alignSelf: "start",
  padding: "6px 8px",
  borderRadius: "6px",
  background: "rgba(166,106,46,0.08)",
  color: "#6f4d2e",
  fontSize: "13px",
  fontWeight: 800,
};

const reviewListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const reviewCardStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  width: "100%",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
  textAlign: "left",
  cursor: "pointer",
};

const reviewTitleStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
  fontSize: "14px",
  fontWeight: 800,
  color: "#3a2410",
};

const reviewMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "#75583b",
  lineHeight: 1.6,
};

function actionRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "center",
    flexDirection: isMobile ? "column" : "row",
    gap: "8px",
  };
}

function confirmActionGroupStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    justifyItems: isMobile ? "stretch" : "end",
    gap: "6px",
    width: isMobile ? "100%" : "auto",
  };
}

const actionNoteStyle: CSSProperties = {
  fontSize: "13px",
  color: "#7a5e42",
  lineHeight: 1.6,
};

const inlineNoteStyle: CSSProperties = {
  fontSize: "13px",
  color: "#7a5e42",
  lineHeight: 1.6,
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  background: "#ba7330",
  color: "#fff8ef",
  padding: "7px 10px",
  fontSize: "13px",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(123, 90, 56, 0.18)",
  borderRadius: "6px",
  background: "#fffdfa",
  color: "#5c442c",
  padding: "7px 10px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid rgba(166,106,46,0.18)",
  borderRadius: "6px",
  background: "rgba(255,248,237,0.92)",
  color: "#8f5624",
  padding: "6px 8px",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
};

const disabledButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

const disabledSuccessButtonStyle: CSSProperties = {
  border: "1px solid rgba(45, 126, 76, 0.2)",
  borderRadius: "6px",
  background: "rgba(232, 248, 237, 0.96)",
  color: "#2d6f45",
  padding: "6px 8px",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "not-allowed",
};

const emptyStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "6px",
  border: "1px dashed rgba(123, 90, 56, 0.22)",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
  background: "rgba(250,246,239,0.75)",
};

const emptyMiniStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "rgba(247,240,230,0.45)",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
};

const lockedHintStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid rgba(45, 126, 76, 0.16)",
  background: "rgba(240, 251, 244, 0.96)",
  color: "#2c6a40",
  fontSize: "13px",
  lineHeight: 1.6,
};

const errorBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid rgba(176, 63, 42, 0.18)",
  background: "rgba(255,243,240,0.96)",
  color: "#ad3e2a",
  fontSize: "13px",
  fontWeight: 700,
};

const successBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid rgba(71, 120, 82, 0.18)",
  background: "rgba(241, 250, 244, 0.96)",
  color: "#336b42",
  fontSize: "13px",
  fontWeight: 700,
};

const infoBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid rgba(166,106,46,0.16)",
  background: "rgba(255,248,237,0.92)",
  color: "#8f5624",
  fontSize: "13px",
  lineHeight: 1.6,
  fontWeight: 700,
};

const sourceInfoStyle: CSSProperties = {
  fontSize: "12px",
  color: "#7a5e42",
  lineHeight: 1.6,
};
