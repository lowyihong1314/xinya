import { useEffect, useMemo, useState } from "react";

import { useUserState } from "../../../app/UserState";
import {
  clearVerifiedPhone,
  formatPhoneForInput,
  get_phone_on_localhost,
  getSavedVerifiedPhone,
} from "../../../js/get_phone_on_localhost";
import { API_BASE } from "../../../js/apiBase";
import { correctPhoneInputMY } from "../../../js/phone";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import {
  createYlpGroupPayment,
  createYlpOrder,
  createYlpOrderItem,
  deleteYlpOrderItem,
  fetchYlpOrderDetail,
  fetchYlpOrdersByPhone,
  listYlpPaymentChannels,
  listYlpRelationOptions,
  previewYlpPaiweiImages,
  updateYlpOrderCustomer,
} from "../api";
import { FahuiOpenGate } from "../FahuiOpenGate";
import type {
  YlpOrderDetail,
  YlpOrderItem,
  YlpOrderSummary,
  YlpPaiweiTablet,
  YlpPaymentChannel,
  YlpRelationOption,
} from "../types";
import { PaiweiEditorModal } from "./PaiweiEditorModal";
import {
  DEFAULT_VERSION,
  currentYlpVersion,
  buildItemPayload,
  createDraft,
  emptyOrderForm,
  getDraftQuantity,
  getDraftTotalPrice,
  getTemplate,
  paiweiTitleForCode,
  normalizePhoneMY,
  validateDraft,
  type OrderFormState,
  type PaiweiCode,
  type PaiweiDraft,
} from "./paiwei";

type IntakeStep = "phone" | "history" | "form" | "confirm" | "pay" | "preview";

type OrderHistoryEntry = {
  summary: YlpOrderSummary;
  detail: YlpOrderDetail | null;
};

const PAIWEI_CODES: PaiweiCode[] = ["A1", "A2", "A3", "B1", "B2", "B3", "C", "D1"];
const STEP_LABELS = ["验证手机", "填写牌位", "确认提交"];

function stepperIndex(step: IntakeStep): number {
  if (step === "phone") return 0;
  if (step === "confirm") return 2;
  return 1;
}

function summarizeDraft(draft: PaiweiDraft): string {
  const template = getTemplate(draft.code);
  const parts: string[] = [];
  if (draft.owner.trim()) parts.push(`阳上：${draft.owner.trim().split(/\r?\n/).join("、")}`);
  if (draft.deceased.trim()) parts.push(`对象：${draft.deceased.trim().split(/\r?\n/).join("、")}`);
  if (draft.surname.trim()) parts.push(`姓氏：${draft.surname.trim()}`);
  if (template.fields.quantity) parts.push(`数量：${getDraftQuantity(draft)}`);
  // 随缘供斋这类只有金额、没有任何姓名栏，摘要就写金额
  if (template.customPrice) parts.push(`金额：RM ${getDraftTotalPrice(draft)}`);
  return parts.join(" · ");
}

function getContactName(form: OrderFormState): string {
  return form.contactName.trim() || form.customerName.trim();
}

function scrollPageTop() {
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function isLockedOrderStatus(status: string | null | undefined): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "approved" || normalized === "paid";
}

function getOrderStatusLabel(status: string | null | undefined): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "paid") return "已付款";
  if (normalized === "pending") return "付款审核中";
  if (normalized === "ready" || normalized === "process") return "处理中";
  return "未付款";
}

function pickFirstValue(item: YlpOrderItem, fieldName: string): string {
  const values = item.item_form_data?.[fieldName] || [];
  return String(values[0]?.val || "").trim();
}

function pickJoinedValues(item: YlpOrderItem, fieldName: string): string {
  const values = item.item_form_data?.[fieldName] || [];
  return values
    .map((entry) => String(entry.val || "").trim())
    .filter(Boolean)
    .join("\n");
}

function coercePaiweiCode(item: YlpOrderItem): PaiweiCode {
  const raw = String(item.code || pickFirstValue(item, "form-group") || "").trim().toUpperCase();
  if (raw === "D") return "D1";
  return PAIWEI_CODES.includes(raw as PaiweiCode) ? (raw as PaiweiCode) : "A1";
}

function draftFromOrderItem(item: YlpOrderItem): PaiweiDraft {
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
    amount: template.customPrice && item.price != null ? String(item.price) : "",
  };
}

function draftsFromOrderDetail(detail: YlpOrderDetail | null): PaiweiDraft[] {
  return (detail?.order_items || []).map(draftFromOrderItem);
}

function itemCount(entry: OrderHistoryEntry): number {
  return (entry.detail?.order_items || []).length;
}

function orderAmount(entry: OrderHistoryEntry): number {
  return (entry.detail?.order_items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
}

function paymentState(summary: YlpOrderSummary): string {
  if (summary.payment_state) return summary.payment_state;
  const status = String(summary.status || "").toLowerCase();
  if (status === "paid") return "paid";
  if (status === "pending") return "pending";
  return "none";
}

function isOrderPayable(summary: YlpOrderSummary): boolean {
  const state = paymentState(summary);
  return state === "none" || state === "rejected";
}

function paymentStateLabel(summary: YlpOrderSummary): string {
  const state = paymentState(summary);
  if (state === "paid") return "已付款";
  if (state === "pending") return "审核中";
  if (state === "rejected") return "付款失败";
  return "未付款";
}

function resolveQrUrl(path?: string | null): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE}${path}` : path;
}

// 开放时间闸门（FahuiOpenGate）：截止期间公开访客自动跳转到当前开放的法会，
// 全部未开放才显示提示页；已登录用户（CRM）不受限。
export function FahuiIntakePage() {
  useEnsureDesignTokens();
  return (
    <FahuiOpenGate selfKey="ylp">
      <FahuiIntakePageInner />
    </FahuiOpenGate>
  );
}

function FahuiIntakePageInner() {
  const { isAuthenticated, isMobile } = useUserState();
  const [step, setStep] = useState<IntakeStep>("phone");
  const [orderForm, setOrderForm] = useState<OrderFormState>(() => emptyOrderForm());
  const [drafts, setDrafts] = useState<PaiweiDraft[]>([]);
  const [editorIndex, setEditorIndex] = useState<number | null | "new">(null);
  const [historyEntries, setHistoryEntries] = useState<OrderHistoryEntry[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [entryLoadingId, setEntryLoadingId] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // 付款
  const [payChannels, setPayChannels] = useState<YlpPaymentChannel[]>([]);
  const [paySelected, setPaySelected] = useState<number[]>([]);
  const [payChannelId, setPayChannelId] = useState<number | null>(null);
  const [payProof, setPayProof] = useState<File | null>(null);
  const [paySubmitting, setPaySubmitting] = useState(false);

  // 预览牌位（全部订单都已付款 / 审核中时才开放）
  const [previewTablets, setPreviewTablets] = useState<YlpPaiweiTablet[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);

  const [relationOptions, setRelationOptions] = useState<string[]>([]);

  const totalAmount = useMemo(
    () => drafts.reduce((sum, draft) => sum + getDraftTotalPrice(draft), 0),
    [drafts],
  );
  const currentYearLabel = DEFAULT_VERSION.replace("_YLP", "");

  const currentYearEntries = useMemo(
    () => historyEntries.filter((entry) => String(entry.summary.version || "") === DEFAULT_VERSION),
    [historyEntries],
  );
  const legacyEntries = useMemo(
    () =>
      historyEntries.filter(
        (entry) =>
          String(entry.summary.version || "") !== DEFAULT_VERSION &&
          String(entry.summary.version || "") !== "DELETE",
      ),
    [historyEntries],
  );
  const currentEditableEntries = useMemo(
    () => currentYearEntries.filter((entry) => !isLockedOrderStatus(entry.summary.status)),
    [currentYearEntries],
  );
  const hasLockedCurrentYear = useMemo(
    () => currentYearEntries.some((entry) => isLockedOrderStatus(entry.summary.status)),
    [currentYearEntries],
  );
  // 「我要付款」只在还有能付的订单时渲染；全部已付款或审核中就换成「预览牌位」。
  const payableEntries = useMemo(
    () => currentYearEntries.filter((entry) => isOrderPayable(entry.summary)),
    [currentYearEntries],
  );
  const canPreviewPaiwei = currentYearEntries.length > 0 && payableEntries.length === 0;
  const activeEntry = useMemo(
    () => (activeOrderId ? historyEntries.find((entry) => entry.summary.id === activeOrderId) || null : null),
    [activeOrderId, historyEntries],
  );
  // 已付款的订单只读。列表里本来就不会出现（currentEditableEntries 已过滤），
  // 这里再兜一层：后台刚批准、页面数据还没刷新时，编辑 / 删除 / 添加一律不渲染。
  const activeOrderLocked = useMemo(
    () => Boolean(activeEntry && isLockedOrderStatus(activeEntry.summary.status)),
    [activeEntry],
  );

  useEffect(() => {
    const savedPhone = getSavedVerifiedPhone();
    if (savedPhone) {
      setOrderForm((current) => ({ ...current, phone: current.phone || formatPhoneForInput(savedPhone) }));
    }
  }, []);

  useEffect(() => {
    listYlpRelationOptions()
      .then((res) => setRelationOptions((res.data || []).map((option: YlpRelationOption) => option.label)))
      .catch(() => setRelationOptions([]));
  }, []);

  // ---- phone access / history ----

  async function ensurePhoneAccess(rawPhone: string): Promise<string> {
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

  function consumeAccessError(nextError: unknown): string {
    const text = nextError instanceof Error ? nextError.message : "请求失败";
    if (!isAuthenticated && /(手机验证|没有权限|未登录)/.test(text)) {
      clearVerifiedPhone();
    }
    return text;
  }

  async function loadOrdersByPhone(verifiedPhone: string): Promise<OrderHistoryEntry[]> {
    const payload = await fetchYlpOrdersByPhone(verifiedPhone);
    const items = (payload.data?.items || []).filter((item) => String(item.version || "") !== "DELETE");
    if (!items.length) {
      return [];
    }
    return Promise.all(
      items.map(async (summary) => {
        try {
          const detailPayload = await fetchYlpOrderDetail(summary.id);
          return { summary, detail: detailPayload.data || null };
        } catch {
          return { summary, detail: null };
        }
      }),
    );
  }

  async function handlePhoneContinue() {
    setError("");
    setMessage("");
    if (!normalizePhoneMY(orderForm.phone)) {
      setError("请填写正确的马来西亚手机号码");
      return;
    }
    setAdvancing(true);
    setHistoryLoading(true);
    try {
      const verifiedPhone = await ensurePhoneAccess(orderForm.phone);
      const nextEntries = await loadOrdersByPhone(verifiedPhone);
      setOrderForm((current) => ({ ...current, phone: formatPhoneForInput(verifiedPhone) }));
      setHistoryEntries(nextEntries);
      if (nextEntries.length) {
        setStep("history");
      } else {
        startFreshCurrentYear();
      }
      scrollPageTop();
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setAdvancing(false);
      setHistoryLoading(false);
    }
  }

  // ---- entering the form ----

  function startFreshCurrentYear() {
    setError("");
    setMessage("");
    setDrafts([]);
    setActiveOrderId(null);
    setStep("form");
    scrollPageTop();
  }

  async function openEntryForEditing(entry: OrderHistoryEntry, source: "current" | "legacy") {
    setError("");
    setMessage("");
    setEntryLoadingId(entry.summary.id);
    try {
      const detail = entry.detail || (await fetchYlpOrderDetail(entry.summary.id)).data || null;
      setDrafts(draftsFromOrderDetail(detail));
      setOrderForm((current) => ({
        ...current,
        customerName: detail?.customer_name || entry.summary.customer_name || current.customerName,
        contactName: detail?.name || entry.summary.name || entry.summary.customer_name || current.contactName,
        email: detail?.email || entry.summary.email || current.email,
        phone: formatPhoneForInput(detail?.phone || entry.summary.phone || current.phone),
      }));
      // 继续编辑今年 → 编辑该订单本身；沿用往年 → 复制内容成今年一张「新」订单（支持今年多张）。
      setActiveOrderId(source === "current" ? entry.summary.id : null);
      setStep("form");
      scrollPageTop();
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setEntryLoadingId(null);
    }
  }

  // ---- draft (牌位) list ----

  function commitDraft(draft: PaiweiDraft) {
    setDrafts((current) => {
      if (editorIndex === "new" || editorIndex == null) {
        return [...current, draft];
      }
      return current.map((existing, index) => (index === editorIndex ? draft : existing));
    });
    setEditorIndex(null);
    setError("");
  }

  function removeDraft(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }

  // ---- confirm / submit ----

  function goToConfirm() {
    setError("");
    if (!orderForm.customerName.trim()) {
      setError("请填写功德主姓名");
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
        return;
      }
    }
    setStep("confirm");
    scrollPageTop();
  }

  async function handleSubmit() {
    setError("");
    setMessage("");
    setSubmitting(true);
    setSubmitProgress({ done: 0, total: drafts.length });
    try {
      const verifiedPhone = await ensurePhoneAccess(orderForm.phone);
      const customerName = orderForm.customerName.trim() || undefined;
      const contactName = getContactName(orderForm);
      const email = orderForm.email.trim() || undefined;

      // 这个页面只写今年：往年订单一律走「复制到今年」，不允许直接更新旧版本的订单。
      const version = currentYlpVersion();
      if (activeEntry && String(activeEntry.summary.version || "") !== version) {
        throw new Error(`只能登记 ${version.replace("_YLP", "")} 年的牌位，请从往年记录「复制到今年」再提交。`);
      }
      // 已付款的订单不给改（原本这层检查挂在「同名同号去重」那条分支上，去重取消后补到这里）
      if (activeOrderLocked) {
        throw new Error(`${currentYearLabel} 年这张订单已经付款，不能再修改。`);
      }

      let orderId = activeOrderId;
      let replaceExistingItems = Boolean(activeOrderId);

      if (!orderId) {
        // 新提交一律另开一张：以前同名同号会命中去重、然后把那张单的牌位全删掉重写，
        // 同一个人交第二份单据时第一份就没了。要改旧单请从下面的记录里点「编辑」。
        const createPayload = await createYlpOrder({
          name: contactName,
          customer_name: customerName,
          phone: verifiedPhone,
          email,
          version,
          force_new: true,
        });
        orderId = createPayload.order?.id || null;
        if (!orderId) {
          throw new Error(createPayload.message || "创建订单失败");
        }
      }

      await updateYlpOrderCustomer(orderId, { customer_name: customerName, email, phone: verifiedPhone });

      if (replaceExistingItems) {
        const existingDetail = await fetchYlpOrderDetail(orderId);
        for (const item of existingDetail.data?.order_items || []) {
          await deleteYlpOrderItem(orderId, item.id);
        }
      }

      for (let index = 0; index < drafts.length; index += 1) {
        const result = await createYlpOrderItem(orderId, buildItemPayload(drafts[index]));
        if (!result.success) {
          throw new Error(result.message || `第 ${index + 1} 项保存失败`);
        }
        setSubmitProgress({ done: index + 1, total: drafts.length });
      }

      const savedCount = drafts.length;
      const refreshedEntries = await loadOrdersByPhone(verifiedPhone);
      setHistoryEntries(refreshedEntries);
      setOrderForm((current) => ({ ...current, phone: formatPhoneForInput(verifiedPhone) }));
      setDrafts([]);
      setActiveOrderId(orderId);
      setStep("history");
      setMessage(`已保存到 ${currentYearLabel} 年订单 #${orderId}，共登记 ${savedCount} 项。`);
      scrollPageTop();
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setSubmitting(false);
      setSubmitProgress(null);
    }
  }

  // ---- 付款 ----

  async function openPreviewStep() {
    setError("");
    setMessage("");
    setPreviewTablets([]);
    setPreviewTruncated(false);
    setPreviewLoading(true);
    setStep("preview");
    scrollPageTop();
    try {
      // 后端把牌位 PDF 逐页转成 JPEG 回来（一次请求拿全部页）。
      const res = await previewYlpPaiweiImages(currentYearEntries.map((entry) => entry.summary.id));
      setPreviewTablets(res.data?.tablets || []);
      setPreviewTruncated(Boolean(res.data?.truncated));
    } catch (nextError) {
      setError(consumeAccessError(nextError));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function openPayStep() {
    setError("");
    setMessage("");
    setPaySelected([]);
    setPayChannelId(null);
    setPayProof(null);
    setStep("pay");
    scrollPageTop();
    try {
      const res = await listYlpPaymentChannels(DEFAULT_VERSION);
      const channels = (res.data || []).filter((channel) => channel.is_active !== false);
      setPayChannels(channels);
      setPayChannelId(channels.length ? channels[0].id : null);
    } catch {
      setPayChannels([]);
    }
  }

  function togglePaySelect(orderId: number) {
    setPaySelected((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
    setError("");
  }

  async function handleGroupPay() {
    setError("");
    if (!paySelected.length) {
      setError("请选择要付款的订单");
      return;
    }
    const channel = payChannels.find((item) => item.id === payChannelId) || null;
    if (payChannels.length && !channel) {
      setError("请选择付款方式");
      return;
    }
    if (!payProof) {
      setError("请上传付款凭证（转账截图 / 收据）");
      return;
    }
    setPaySubmitting(true);
    try {
      const data = new FormData();
      data.append("order_ids", JSON.stringify(paySelected));
      data.append("payment_mode", channel ? channel.channel_type : "other");
      if (channel) data.append("channel_id", String(channel.id));
      data.append("file", payProof);
      const res = await createYlpGroupPayment(data);
      if (!res.success) {
        throw new Error(res.message || "提交失败，请稍后再试");
      }
      const count = paySelected.length;
      const verifiedPhone = normalizePhoneMY(orderForm.phone);
      const refreshed = verifiedPhone ? await loadOrdersByPhone(verifiedPhone) : historyEntries;
      setHistoryEntries(refreshed);
      setStep("history");
      setMessage(`付款资料已提交（${count} 张订单），等待管理员核对。`);
      scrollPageTop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后再试");
    } finally {
      setPaySubmitting(false);
    }
  }

  const payTotal = useMemo(
    () =>
      currentYearEntries
        .filter((entry) => paySelected.includes(entry.summary.id))
        .reduce((sum, entry) => sum + orderAmount(entry), 0),
    [currentYearEntries, paySelected],
  );

  // ---- derived ----

  const displayPhone = formatPhoneForInput(orderForm.phone) || orderForm.phone.trim();
  const submitLabel = activeOrderId ? `更新 ${currentYearLabel} 年订单` : "提交并建立订单";
  const activeStepIndex = stepperIndex(step);
  const editorDraft: PaiweiDraft | null =
    editorIndex === "new" ? createDraft("A1") : editorIndex == null ? null : drafts[editorIndex] ?? null;

  return (
    <div style={styles.page}>
      <div style={styles.shell(isMobile)}>
        <header style={styles.head}>
          <p style={styles.eyebrow}>盂兰盆法会 · 牌位登记</p>
          <h1 style={styles.title}>{currentYearLabel} 年牌位填写</h1>
        </header>

        <ol style={styles.stepper}>
          {STEP_LABELS.map((label, index) => {
            const done = index < activeStepIndex;
            const active = index === activeStepIndex;
            return (
              <li key={label} style={styles.stepItem}>
                <span
                  style={{
                    ...styles.stepDot,
                    ...(done ? styles.stepDotDone : {}),
                    ...(active ? styles.stepDotActive : {}),
                  }}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span style={{ ...styles.stepText, ...(active ? styles.stepTextActive : {}) }}>{label}</span>
              </li>
            );
          })}
        </ol>

        {message ? <div style={styles.successBox}>{message}</div> : null}
        {error ? <div style={styles.errorBox}>{error}</div> : null}

        {step === "phone" ? (
          <section style={styles.card}>
            <p style={styles.help}>请输入报名所用的手机号码，用于查询或建立您的牌位订单。</p>
            <label style={styles.fieldLabel} htmlFor="intake-phone">
              手机号码
            </label>
            <input
              id="intake-phone"
              style={styles.input}
              inputMode="tel"
              placeholder="例如 012-3456789"
              value={orderForm.phone}
              disabled={advancing}
              onChange={(event) =>
                setOrderForm((current) => ({ ...current, phone: correctPhoneInputMY(event.target.value) }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void handlePhoneContinue();
              }}
            />
            <button
              type="button"
              style={{ ...styles.primaryButton, ...(advancing ? styles.buttonDisabled : {}) }}
              onClick={() => void handlePhoneContinue()}
              disabled={advancing}
            >
              {advancing ? (historyLoading ? "查询中…" : "验证中…") : "继续"}
            </button>
          </section>
        ) : null}

        {step === "history" ? (
          <section style={styles.stack}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>我的资料</p>
              <p style={styles.help}>手机 {displayPhone} 名下的订单。请选择一项，或全新填写。</p>
            </div>

            <div style={styles.card}>
              <p style={styles.cardTitle}>继续编辑今年（{currentYearLabel}）</p>
              {currentEditableEntries.length ? (
                <div style={styles.stack}>
                  {currentEditableEntries.map((entry) => (
                    <button
                      key={entry.summary.id}
                      type="button"
                      style={styles.entryCard}
                      disabled={entryLoadingId === entry.summary.id}
                      onClick={() => void openEntryForEditing(entry, "current")}
                    >
                      <div style={styles.entryTop}>
                        <span style={styles.entryTitle}>
                          {entry.summary.customer_name || "功德主"} · 订单 #{entry.summary.id}
                        </span>
                        <span style={styles.entryStatus}>{getOrderStatusLabel(entry.summary.status)}</span>
                      </div>
                      <span style={styles.entryMeta}>{itemCount(entry)} 项牌位</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p style={styles.help}>今年还没有可编辑的订单。</p>
              )}
              {hasLockedCurrentYear ? (
                <div style={styles.lockedChip}>今年另有已付款订单，无法再修改</div>
              ) : null}
              <button type="button" style={styles.addButton} onClick={startFreshCurrentYear}>
                + 全新填写一张今年订单
              </button>
              {canPreviewPaiwei ? (
                <button type="button" style={styles.previewButton} onClick={() => void openPreviewStep()}>
                  预览牌位
                </button>
              ) : null}
              {payableEntries.length ? (
                <button type="button" style={styles.payButton} onClick={() => void openPayStep()}>
                  我要付款
                </button>
              ) : null}
            </div>

            {legacyEntries.length ? (
              <div style={styles.card}>
                <p style={styles.cardTitle}>沿用往年资料</p>
                <p style={styles.help}>选一张往年订单，复制内容成今年的一张新订单。</p>
                <div style={styles.stack}>
                  {legacyEntries.map((entry) => {
                    const year = String(entry.summary.version || "").replace("_YLP", "") || "往年";
                    return (
                      <button
                        key={entry.summary.id}
                        type="button"
                        style={styles.entryCardTight}
                        disabled={entryLoadingId === entry.summary.id}
                        onClick={() => void openEntryForEditing(entry, "legacy")}
                      >
                        <div style={styles.entryTop}>
                          <span style={styles.entryTitle}>沿用 {year} 年资料</span>
                          <span style={styles.entryMeta}>{itemCount(entry)} 项</span>
                        </div>
                        <span style={styles.entryMeta}>{entry.summary.customer_name || "功德主"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div style={styles.rowButtons}>
              <button type="button" style={styles.ghostButton} onClick={() => setStep("phone")}>
                ← 换个手机号
              </button>
            </div>
          </section>
        ) : null}

        {step === "form" ? (
          <section style={styles.stack}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>功德主资料</p>
              <label style={styles.fieldLabel}>功德主姓名 *</label>
              <input
                style={styles.input}
                placeholder="牌位上的功德主姓名"
                readOnly={activeOrderLocked}
                value={orderForm.customerName}
                onChange={(event) => setOrderForm((c) => ({ ...c, customerName: event.target.value }))}
              />
              <label style={styles.fieldLabel}>联络人姓名（选填）</label>
              <input
                style={styles.input}
                placeholder="留空则同功德主"
                readOnly={activeOrderLocked}
                value={orderForm.contactName}
                onChange={(event) => setOrderForm((c) => ({ ...c, contactName: event.target.value }))}
              />
              <label style={styles.fieldLabel}>电子邮箱（选填）</label>
              <input
                style={styles.input}
                inputMode="email"
                placeholder="用于接收付款通知"
                readOnly={activeOrderLocked}
                value={orderForm.email}
                onChange={(event) => setOrderForm((c) => ({ ...c, email: event.target.value }))}
              />
              <div style={styles.phoneRow}>
                <span style={styles.phoneRowLabel}>手机号码</span>
                <span style={styles.phoneRowValue}>{displayPhone}</span>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.listHead}>
                <p style={styles.cardTitle}>牌位清单（{drafts.length}）</p>
                <span style={styles.listTotal}>小计 RM {totalAmount}</span>
              </div>

              {drafts.length ? (
                <div style={styles.stack}>
                  {drafts.map((draft, index) => {
                    const template = getTemplate(draft.code);
                    return (
                      <div key={draft.id} style={styles.draftCard}>
                        <div style={styles.draftMain}>
                          <div style={styles.draftTop}>
                            <span style={styles.draftName}>{template.title}</span>
                            <span style={styles.draftPrice}>RM {getDraftTotalPrice(draft)}</span>
                          </div>
                          {summarizeDraft(draft) ? (
                            <span style={styles.draftSummary}>{summarizeDraft(draft)}</span>
                          ) : null}
                        </div>
                        {activeOrderLocked ? null : (
                          <div style={styles.draftActions}>
                            <button type="button" style={styles.smallButton} onClick={() => setEditorIndex(index)}>
                              编辑
                            </button>
                            <button type="button" style={styles.smallDanger} onClick={() => removeDraft(index)}>
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={styles.emptyHint}>还没有添加牌位，点下方按钮开始添加。</p>
              )}

              {activeOrderLocked ? (
                <div style={styles.lockedChip}>这张订单已经付款，牌位不能再修改</div>
              ) : (
                <button type="button" style={styles.addButton} onClick={() => setEditorIndex("new")}>
                  + 添加牌位
                </button>
              )}
            </div>

            <div style={styles.rowButtons}>
              <button
                type="button"
                style={styles.ghostButton}
                onClick={() => setStep(historyEntries.length ? "history" : "phone")}
              >
                ← 返回
              </button>
              {activeOrderLocked ? null : (
                <button type="button" style={styles.primaryButton} onClick={goToConfirm}>
                  下一步：确认
                </button>
              )}
            </div>
          </section>
        ) : null}

        {step === "confirm" ? (
          <section style={styles.stack}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>确认资料</p>
              <dl style={styles.summaryList}>
                <SummaryRow label="功德主" value={orderForm.customerName.trim() || "-"} />
                <SummaryRow label="联络人" value={getContactName(orderForm) || "-"} />
                <SummaryRow label="手机" value={displayPhone || "-"} />
                <SummaryRow label="邮箱" value={orderForm.email.trim() || "未填写"} />
              </dl>
            </div>

            <div style={styles.card}>
              <div style={styles.listHead}>
                <p style={styles.cardTitle}>牌位（{drafts.length}）</p>
                <span style={styles.listTotal}>合计 RM {totalAmount}</span>
              </div>
              <div style={styles.stack}>
                {drafts.map((draft) => {
                  const template = getTemplate(draft.code);
                  return (
                    <div key={draft.id} style={styles.confirmRow}>
                      <span style={styles.confirmName}>{template.title}</span>
                      <span style={styles.confirmSummary}>{summarizeDraft(draft) || "—"}</span>
                      <span style={styles.confirmPrice}>RM {getDraftTotalPrice(draft)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              style={{ ...styles.primaryButton, ...(submitting ? styles.buttonDisabled : {}) }}
              onClick={() => void handleSubmit()}
              disabled={submitting}
            >
              {submitting
                ? submitProgress
                  ? `提交中… (${submitProgress.done}/${submitProgress.total})`
                  : "提交中…"
                : submitLabel}
            </button>
            <button type="button" style={styles.ghostButton} onClick={() => setStep("form")} disabled={submitting}>
              ← 返回修改
            </button>
          </section>
        ) : null}

        {step === "pay" ? (
          <section style={styles.stack}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>选择要付款的订单</p>
              <p style={styles.help}>可勾选多张订单合并成一次付款。已付款或审核中的订单不可选。</p>
              <div style={styles.stack}>
                {currentYearEntries.map((entry) => {
                  const payable = isOrderPayable(entry.summary);
                  const checked = paySelected.includes(entry.summary.id);
                  return (
                    <button
                      key={entry.summary.id}
                      type="button"
                      style={{
                        ...styles.payOrderRow,
                        ...(checked ? styles.payOrderRowActive : {}),
                        ...(payable ? {} : styles.payOrderRowDisabled),
                      }}
                      disabled={!payable}
                      onClick={() => togglePaySelect(entry.summary.id)}
                    >
                      <span style={styles.payCheck}>{checked ? "☑" : payable ? "☐" : "🔒"}</span>
                      <span style={styles.payOrderMain}>
                        <span style={styles.payOrderName}>
                          {entry.summary.customer_name || "功德主"} · 订单 #{entry.summary.id}
                        </span>
                        <span style={styles.payOrderMeta}>
                          {itemCount(entry)} 项 · {payable ? "可付款" : paymentStateLabel(entry.summary)}
                        </span>
                      </span>
                      <span style={styles.payOrderAmount}>RM {orderAmount(entry)}</span>
                    </button>
                  );
                })}
              </div>
              <div style={styles.payTotalRow}>
                <span>已选 {paySelected.length} 张</span>
                <span style={styles.payTotalValue}>合计 RM {payTotal}</span>
              </div>
            </div>

            <div style={styles.card}>
              <p style={styles.cardTitle}>付款方式</p>
              {payChannels.length ? (
                <div style={styles.stack}>
                  {payChannels.map((channel) => {
                    const active = channel.id === payChannelId;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        style={{ ...styles.channelOption, ...(active ? styles.channelOptionActive : {}) }}
                        onClick={() => setPayChannelId(channel.id)}
                      >
                        <div style={styles.entryTop}>
                          <span style={styles.entryTitle}>
                            {channel.channel_type === "qr" ? "扫码支付" : "银行转账"}
                            {channel.label ? ` · ${channel.label}` : ""}
                          </span>
                          <span style={styles.payCheck}>{active ? "●" : "○"}</span>
                        </div>
                        {active && channel.channel_type === "qr" && channel.qr_image_path ? (
                          <img src={resolveQrUrl(channel.qr_image_path)} alt="收款码" style={styles.payQr} />
                        ) : null}
                        {active && channel.channel_type === "bank" ? (
                          <div style={styles.payBankInfo}>
                            <span>{channel.bank_name || "-"}</span>
                            <span style={styles.payBankAcc}>{channel.bank_account_no || "-"}</span>
                            <span>{channel.bank_account_name || ""}</span>
                          </div>
                        ) : null}
                        {active && channel.note ? <span style={styles.entryMeta}>{channel.note}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p style={styles.help}>暂未配置收款方式，请上传付款凭证或联系管理员。</p>
              )}

              <label style={styles.fieldLabel}>付款凭证（转账截图 / 收据）</label>
              <input
                style={styles.input}
                type="file"
                accept="image/png,image/jpeg,application/pdf,.heic,.heif"
                onChange={(event) => setPayProof(event.target.files?.[0] ?? null)}
              />
              {payProof ? <span style={styles.fileHint}>已选择：{payProof.name}</span> : null}
            </div>

            <button
              type="button"
              style={{ ...styles.primaryButton, ...(paySubmitting || !paySelected.length ? styles.buttonDisabled : {}) }}
              onClick={() => void handleGroupPay()}
              disabled={paySubmitting || !paySelected.length}
            >
              {paySubmitting ? "提交中…" : `提交付款（RM ${payTotal}）`}
            </button>
            <button type="button" style={styles.ghostButton} onClick={() => setStep("history")} disabled={paySubmitting}>
              ← 返回
            </button>
          </section>
        ) : null}

        {step === "preview" ? (
          <section style={styles.stack}>
            <div style={styles.card}>
              <p style={styles.cardTitle}>预览牌位</p>
              <p style={styles.help}>
                {currentYearLabel} 年名下牌位的打印效果，和现场张贴的版式一致。如有错字请联络工作人员。
              </p>
            </div>

            {previewLoading ? (
              <div style={styles.card}>
                <p style={styles.emptyHint}>正在生成预览图…</p>
              </div>
            ) : previewTablets.length ? (
              <div style={styles.stack}>
                <div style={styles.previewGrid}>
                  {previewTablets.map((tablet, index) => (
                    <div key={`${tablet.order_id}-${tablet.item_id ?? index}`} style={styles.previewCard}>
                      <img
                        src={tablet.image}
                        alt={`${paiweiTitleForCode(tablet.code)}（订单 ${tablet.order_id}）`}
                        style={styles.previewImage}
                      />
                      <span style={styles.previewCaption}>
                        {paiweiTitleForCode(tablet.code)} · #{tablet.order_id}
                      </span>
                    </div>
                  ))}
                </div>
                {previewTruncated ? (
                  <div style={styles.card}>
                    <p style={styles.emptyHint}>牌位较多，这里只显示前 {previewTablets.length} 张。</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={styles.card}>
                <p style={styles.emptyHint}>没有可预览的牌位。</p>
              </div>
            )}

            <button type="button" style={styles.ghostButton} onClick={() => setStep("history")}>
              ← 返回
            </button>
          </section>
        ) : null}
      </div>

      {editorDraft ? (
        <PaiweiEditorModal
          initialDraft={editorDraft}
          isEdit={editorIndex !== "new"}
          relationOptions={relationOptions}
          // 公开访客每项只能填一个（不渲染加行按钮）；登录的工作人员不受限。
          allowAddRows={isAuthenticated}
          onCancel={() => setEditorIndex(null)}
          onSave={commitDraft}
        />
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.summaryRow}>
      <dt style={styles.summaryKey}>{label}</dt>
      <dd style={styles.summaryVal}>{value}</dd>
    </div>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background: "var(--x-color-canvas)",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
    boxSizing: "border-box",
  },
  shell: (isMobile: boolean) => ({
    maxWidth: 560,
    margin: "0 auto",
    padding: isMobile ? "18px 14px 40px" : "28px 20px 48px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  }),
  head: { textAlign: "center" },
  eyebrow: {
    margin: 0,
    fontSize: "12px",
    letterSpacing: "1px",
    fontWeight: 700,
    color: "var(--x-color-accent)",
  },
  title: {
    margin: "4px 0 0",
    fontSize: "22px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
  },
  stepper: {
    display: "flex",
    justifyContent: "space-between",
    listStyle: "none",
    padding: 0,
    margin: 0,
    gap: "4px",
  },
  stepItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: 1 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 700,
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    border: "1px solid var(--x-color-line)",
  },
  stepDotActive: { background: "var(--x-color-accent)", color: "#fff", borderColor: "var(--x-color-accent)" },
  stepDotDone: {
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    borderColor: "var(--x-color-accent-border)",
  },
  stepText: { fontSize: "11px", color: "var(--x-color-ink-muted)" },
  stepTextActive: { color: "var(--x-color-accent-strong)", fontWeight: 700 },
  successBox: {
    padding: "12px 14px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-success-soft)",
    color: "var(--x-color-success)",
    border: "1px solid rgba(21,128,61,0.28)",
    fontSize: "13px",
  },
  errorBox: {
    padding: "12px 14px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    border: "1px solid var(--x-color-danger-border)",
    fontSize: "13px",
  },
  card: {
    background: "var(--x-color-panel)",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 12px 30px var(--x-color-shadow-soft)",
    padding: "16px 16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  stack: { display: "flex", flexDirection: "column", gap: "12px" },
  cardTitle: { margin: 0, fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" },
  help: { margin: 0, fontSize: "13px", lineHeight: 1.5, color: "var(--x-color-ink-muted)" },
  fieldLabel: { fontSize: "13px", fontWeight: 600, color: "var(--x-color-ink)", marginTop: "2px" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 13px",
    fontSize: "15px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  primaryButton: {
    width: "100%",
    padding: "13px 16px",
    fontSize: "15px",
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    marginTop: "4px",
  },
  buttonDisabled: { opacity: 0.55, cursor: "not-allowed" },
  ghostButton: {
    flex: 1,
    padding: "12px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--x-color-ink-muted)",
    background: "transparent",
    border: "1px solid var(--x-color-line)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  rowButtons: { display: "flex", gap: "10px", alignItems: "center" },
  previewButton: {
    width: "100%",
    padding: "12px",
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    marginTop: "4px",
  },
  previewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: "10px",
  },
  previewCard: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "8px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
  },
  previewCaption: {
    fontSize: "11px",
    fontWeight: 600,
    textAlign: "center",
    color: "var(--x-color-ink-muted)",
  },
  previewImage: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: "var(--x-radius-sm)",
    background: "#fff",
  },
  lockedChip: {
    padding: "8px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-success-soft)",
    color: "var(--x-color-success)",
    border: "1px solid rgba(21,128,61,0.28)",
    fontSize: "12px",
    fontWeight: 600,
  },
  entryCard: {
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  entryCardTight: {
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  entryDisabled: { opacity: 0.5, cursor: "not-allowed" },
  entryTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" },
  entryTitle: { fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" },
  entryStatus: { fontSize: "12px", fontWeight: 700, color: "var(--x-color-accent-strong)" },
  entryMeta: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  listHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  listTotal: { fontSize: "14px", fontWeight: 800, color: "var(--x-color-accent-strong)" },
  emptyHint: {
    margin: 0,
    padding: "14px",
    textAlign: "center",
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
    background: "var(--x-color-panel-alt)",
    borderRadius: "var(--x-radius-sm)",
    border: "1px dashed var(--x-color-line)",
  },
  draftCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "12px 14px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  draftMain: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, flex: 1 },
  draftTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" },
  draftName: { fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" },
  draftPrice: { fontSize: "14px", fontWeight: 800, color: "var(--x-color-accent-strong)", whiteSpace: "nowrap" },
  draftSummary: { fontSize: "12px", color: "var(--x-color-ink-muted)", lineHeight: 1.5 },
  draftActions: { display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 },
  smallButton: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-accent-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  smallDanger: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--x-color-danger)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-danger-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  addButton: {
    width: "100%",
    padding: "12px",
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-accent-soft)",
    border: "1px dashed var(--x-color-accent-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    marginTop: "4px",
  },
  phoneRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-panel-alt)",
    marginTop: "2px",
  },
  phoneRowLabel: { fontSize: "13px", color: "var(--x-color-ink-muted)" },
  phoneRowValue: { fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" },
  summaryList: { margin: 0, display: "flex", flexDirection: "column", gap: "8px" },
  summaryRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", margin: 0 },
  summaryKey: { margin: 0, fontSize: "13px", color: "var(--x-color-ink-muted)" },
  summaryVal: { margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--x-color-ink)", textAlign: "right" },
  confirmRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "baseline",
    gap: "10px",
    padding: "10px 0",
    borderBottom: "1px solid var(--x-color-line-soft)",
  },
  confirmName: { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink)", whiteSpace: "nowrap" },
  confirmSummary: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  confirmPrice: { fontSize: "13px", fontWeight: 800, color: "var(--x-color-accent-strong)", whiteSpace: "nowrap" },
  payButton: {
    width: "100%",
    padding: "12px",
    fontSize: "14px",
    fontWeight: 800,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    marginTop: "4px",
  },
  payOrderRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    cursor: "pointer",
  },
  payOrderRowActive: { borderColor: "var(--x-color-accent)", background: "var(--x-color-accent-soft)" },
  payOrderRowDisabled: { opacity: 0.55, cursor: "not-allowed" },
  payCheck: { fontSize: "18px", color: "var(--x-color-accent-strong)", flexShrink: 0 },
  payOrderMain: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, flex: 1 },
  payOrderName: { fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" },
  payOrderMeta: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  payOrderAmount: { fontSize: "14px", fontWeight: 800, color: "var(--x-color-accent-strong)", whiteSpace: "nowrap" },
  payTotalRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "6px",
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
  },
  payTotalValue: { fontSize: "15px", fontWeight: 800, color: "var(--x-color-accent-strong)" },
  channelOption: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px 14px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    cursor: "pointer",
  },
  channelOptionActive: { borderColor: "var(--x-color-accent)", background: "var(--x-color-accent-soft)" },
  payQr: {
    width: 160,
    height: 160,
    objectFit: "contain",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "#fff",
    alignSelf: "center",
  },
  payBankInfo: { display: "flex", flexDirection: "column", gap: "2px", fontSize: "13px", color: "var(--x-color-ink)" },
  payBankAcc: { fontWeight: 800, fontFamily: "var(--x-font-mono)", fontSize: "15px" },
  fileHint: { fontSize: "12px", color: "var(--x-color-success)" },
};
