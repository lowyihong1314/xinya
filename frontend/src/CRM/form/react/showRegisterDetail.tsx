import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { open_parental_form } from "../../../../../static/js/form/parental/modal.js";
import { openOverlay } from "../../../app/OverlayProvider";
import { CachedImage } from "../../../components/CachedMedia";
import { showConfirmDialog } from "../../../js/dialogs";
import { designTokens } from "../../../theme/designTokens";
import { createMemberPayment, previewMemberNricChange, updateMemberPaymentStatus } from "./api";
import type {
  ExtraFieldConfig,
  FormFee,
  FormMember,
  FormMemberExtraField,
  FormMemberTimeSlot,
  FormPayment,
  FormRecord,
} from "./types";

type ParentalData = {
  parent_cn?: string | null;
  parent_phone?: string | null;
  child_cn?: string | null;
  child_nric?: string | null;
  sign?: string | null;
  sign_date?: string | null;
};

type ShowRegisterDetailOptions = {
  member: FormMember;
  form?: FormRecord;
  formId?: number;
  extraFields?: ExtraFieldConfig[];
  fees?: FormFee[];
  onSaveField?: (member: FormMember, field: string | number, value: unknown) => Promise<void>;
  onPaymentChanged?: () => void;
  canManagePayments?: boolean;
  canConfirmPayments?: boolean;
  readOnly?: boolean;
};

const PAYMENT_MODE_OPTIONS = ["现金", "QR", "CDM", "银行转账", "支票"];

type EditableField = {
  key: string;
  label: string;
  value: unknown;
  multiline?: boolean;
  fieldType?: string;
  options?: string[] | null;
};

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <div style={sectionTitleStyle}>{title}</div>
        {action}
      </div>
      <div style={sectionBodyStyle}>{children}</div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        ...summaryCardStyle,
        ...(accent ? summaryCardAccentStyle : null),
      }}
    >
      <div style={summaryLabelStyle}>{label}</div>
      <div style={summaryValueStyle}>{value}</div>
    </div>
  );
}

function ReadItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={readItemStyle}>
      <div style={readLabelStyle}>{label}</div>
      <div style={readValueStyle}>{formatDisplayValue(value)}</div>
    </div>
  );
}

function EditRow({
  field,
  disabled,
  readOnly,
  value,
  onChange,
}: {
  field: EditableField;
  disabled: boolean;
  readOnly?: boolean;
  value: string;
  onChange: (field: EditableField, value: string) => void;
}) {
  const checkboxValue = normalizeCheckboxValue(value);

  return (
    <div style={editRowStyle}>
      <div style={editLabelStyle}>{field.label}</div>
      <div style={editControlWrapStyle}>
        {field.fieldType === "checkbox" ? (
          <label style={checkboxWrapStyle}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={checkboxValue}
              onChange={(event) => onChange(field, event.target.checked ? "true" : "false")}
            />
            <span>{checkboxValue ? "已勾选" : "未勾选"}</span>
          </label>
        ) : field.fieldType === "select" ? (
          <select
            style={inputStyle}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(field, event.target.value)}
          >
            <option value="">请选择</option>
            {(field.options || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.multiline ? (
          <textarea
            rows={4}
            style={textareaStyle}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(field, event.target.value)}
          />
        ) : (
          <input
            type={field.fieldType === "date" || field.fieldType === "number" ? field.fieldType : "text"}
            style={inputStyle}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(field, event.target.value)}
          />
        )}
      </div>
      <div style={editHintStyle}>{readOnly ? "只读" : disabled ? "保存中" : "可编辑"}</div>
    </div>
  );
}

function PaymentCard({ payment }: { payment: FormPayment }) {
  const proofPath =
    typeof payment.proof_image_url === "string" && payment.proof_image_url
      ? payment.proof_image_url
      : typeof payment.proof_image_path === "string"
        ? payment.proof_image_path
        : "";
  const statusMeta = getPaymentStatusMeta(payment.status);
  return (
    <article style={paymentCardStyle}>
      <div style={paymentMetaGridStyle}>
        <ReadItem label="付款单号" value={payment.id} />
        <div style={readItemStyle}>
          <div style={readLabelStyle}>状态</div>
          <div style={{ ...statusBadgeStyle, color: statusMeta.textColor, background: statusMeta.background }}>
            {statusMeta.label}
          </div>
        </div>
        <ReadItem label="方式" value={payment.payment_mode} />
        <ReadItem label="金额" value={formatPrice(payment.price)} />
        <ReadItem label="日期" value={payment.date} />
        <ReadItem label="时间" value={payment.time} />
        <ReadItem label="柜台" value={payment.counter} />
        <ReadItem label="电话" value={payment.phone} />
      </div>
      {proofPath ? (
        <div style={paymentProofWrapStyle}>
          <div style={subtleLabelStyle}>付款截图</div>
          <a href={proofPath} target="_blank" rel="noreferrer" style={proofLinkStyle}>
            查看原图
          </a>
          <CachedImage src={proofPath} cacheKey={`register-detail-proof:${payment.id}`} alt={`payment-proof-${payment.id}`} style={paymentProofImageStyle} />
        </div>
      ) : null}
    </article>
  );
}

function PaymentComposer({
  formId,
  nric,
  fees,
  canConfirm,
  onCreated,
}: {
  formId: number;
  nric: string;
  fees: FormFee[];
  canConfirm: boolean;
  onCreated: (payment: FormPayment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [feeId, setFeeId] = useState<string>(() => (fees[0] ? String(fees[0].id) : ""));
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODE_OPTIONS[0]);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [markChecked, setMarkChecked] = useState(false);
  const [counter, setCounter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setFeeId(fees[0] ? String(fees[0].id) : "");
    setPaymentMode(PAYMENT_MODE_OPTIONS[0]);
    setProofFile(null);
    setMarkChecked(false);
    setCounter("");
    setError("");
  }

  async function handleSubmit() {
    setError("");
    if (!nric) {
      setError("这个成员没有 NRIC，无法记录付款");
      return;
    }
    const parsedFeeId = Number(feeId);
    if (!feeId || Number.isNaN(parsedFeeId)) {
      setError("请选择收费项");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createMemberPayment(
        formId,
        { nric, fee_id: parsedFeeId, payment_mode: paymentMode.trim() || "现金" },
        proofFile,
      );
      let payment = created.payment;
      if (!payment) {
        throw new Error(created.message || "记录付款失败");
      }
      if (markChecked && canConfirm) {
        const confirmed = await updateMemberPaymentStatus(payment.id, "checked", counter.trim() || undefined);
        payment = confirmed.payment || { ...payment, status: "checked", counter: counter.trim() || null };
      }
      onCreated(payment);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "记录付款失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" style={composerToggleStyle} onClick={() => setOpen(true)}>
        + 帮成员记录付款
      </button>
    );
  }

  return (
    <div style={composerStyle}>
      <div style={composerHeaderStyle}>
        <span style={composerTitleStyle}>记录付款</span>
        <button
          type="button"
          style={composerCloseStyle}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          取消
        </button>
      </div>

      {error ? <div style={composerErrorStyle}>{error}</div> : null}

      <div style={composerFieldStyle}>
        <label style={composerLabelStyle}>收费项</label>
        {fees.length ? (
          <select style={inputStyle} value={feeId} onChange={(event) => setFeeId(event.target.value)} disabled={submitting}>
            {fees.map((fee) => (
              <option key={fee.id} value={String(fee.id)}>
                {fee.category} · RM {Number(fee.amount || 0).toFixed(2)}
              </option>
            ))}
          </select>
        ) : (
          <div style={emptyStateStyle}>这个表格还没有设置报名费，请先到「报名费」分页添加。</div>
        )}
      </div>

      <div style={composerFieldStyle}>
        <label style={composerLabelStyle}>付款方式</label>
        <select style={inputStyle} value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)} disabled={submitting}>
          {PAYMENT_MODE_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      <div style={composerFieldStyle}>
        <label style={composerLabelStyle}>付款截图（可选）</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/heic,image/heif"
          style={{ ...inputStyle, padding: "5px" }}
          disabled={submitting}
          onChange={(event) => setProofFile(event.target.files?.[0] || null)}
        />
      </div>

      {canConfirm ? (
        <div style={composerFieldStyle}>
          <label style={checkboxWrapStyle}>
            <input
              type="checkbox"
              checked={markChecked}
              disabled={submitting}
              onChange={(event) => setMarkChecked(event.target.checked)}
            />
            <span>直接标记为「已确认」</span>
          </label>
          {markChecked ? (
            <input
              type="text"
              style={inputStyle}
              placeholder="柜台 / 经手人（可选）"
              value={counter}
              disabled={submitting}
              onChange={(event) => setCounter(event.target.value)}
            />
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        style={{ ...saveButtonStyle, opacity: submitting || !fees.length ? 0.6 : 1, cursor: submitting || !fees.length ? "not-allowed" : "pointer" }}
        disabled={submitting || !fees.length}
        onClick={() => void handleSubmit()}
      >
        {submitting ? "提交中" : "记录付款"}
      </button>
    </div>
  );
}

function MemberDetailModal({
  member,
  form,
  formId,
  extraFields,
  fees,
  onSaveField,
  onPaymentChanged,
  canManagePayments = false,
  canConfirmPayments = false,
  readOnly = false,
  onClose,
}: ShowRegisterDetailOptions & {
  onClose: () => void;
}) {
  const parental = (member.parental_data || null) as ParentalData | null;
  const parentalFormEnabled = Boolean(parental || (form?.field_switches?.parental_form ?? form?.parental_form));
  const parentalFormContext = form ?? (formId ? ({ id: formId, title: "" } as FormRecord) : null);
  const availableSlots = Array.isArray(member.available_time_slot_json)
    ? (member.available_time_slot_json as FormMemberTimeSlot[])
    : [];
  const [payments, setPayments] = useState<FormPayment[]>(
    Array.isArray(member.payments) ? member.payments : [],
  );
  const effectiveFormId = formId ?? form?.id ?? null;
  const availableFees = fees && fees.length ? fees : form?.fees || [];
  const [saving, setSaving] = useState(false);

  const editableBaseFields = useMemo<EditableField[]>(
    () => [
      { key: "name_cn", label: "中文名", value: member.name_cn },
      { key: "name", label: "英文名", value: member.name },
      { key: "nric", label: "NRIC", value: member.nric },
      { key: "phone", label: "电话", value: member.phone },
      { key: "email", label: "Email", value: member.email },
      { key: "gender", label: "性别", value: member.gender },
      { key: "address", label: "居住地址", value: member.address, multiline: true },
      { key: "medical", label: "医疗备注", value: member.medical, multiline: true },
      { key: "allergy", label: "过敏", value: member.allergy, multiline: true },
      { key: "other_remark", label: "其他备注", value: member.other_remark, multiline: true },
      { key: "parent_1", label: "家长 1", value: member.parent_1 },
      { key: "parent_1_phone", label: "家长 1 电话", value: member.parent_1_phone },
      { key: "parent_2", label: "家长 2", value: member.parent_2 },
      { key: "parent_2_phone", label: "家长 2 电话", value: member.parent_2_phone },
    ],
    [member],
  );

  const editableExtraFields = useMemo<EditableField[]>(() => {
    const values = Array.isArray(member.extra_fields || member.field_values)
      ? ((member.extra_fields || member.field_values) as FormMemberExtraField[])
      : [];
    return (extraFields || []).map((field) => ({
      key: `extra-${field.id}`,
      label: field.label,
      value: values.find((item) => item.field_config_id === field.id)?.field_value,
      multiline: field.field_type === "textarea",
      fieldType: field.field_type,
      options: field.options || null,
    }));
  }, [extraFields, member.extra_fields, member.field_values]);

  const editableFields = useMemo(
    () => [...editableBaseFields, ...editableExtraFields],
    [editableBaseFields, editableExtraFields],
  );

  const [draftValues, setDraftValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editableFields.map((field) => [field.key, normalizeFieldValue(field.value)])),
  );
  const [saveError, setSaveError] = useState("");

  const dirtyFields = useMemo(
    () =>
      editableFields.filter((field) => draftValues[field.key] !== normalizeFieldValue(field.value)),
    [draftValues, editableFields],
  );

  function handleFieldChange(field: EditableField, value: string) {
    if (saveError) {
      setSaveError("");
    }
    setDraftValues((current) => ({ ...current, [field.key]: value }));
  }

  async function handleSaveAll() {
    if (readOnly || !onSaveField || !formId || !dirtyFields.length) {
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const nricField = dirtyFields.find((field) => field.key === "nric");
      if (nricField) {
        const preview = await previewMemberNricChange({
          member_id: member.id,
          new_nric: draftValues[nricField.key] ?? "",
        });
        const shouldContinue = await showConfirmDialog({
          title: "确认修改身份证",
          message: buildNricChangeConfirmMessage(preview),
        });
        if (!shouldContinue) {
          return;
        }
      }

      const fieldsToSave = [
        ...dirtyFields.filter((field) => field.key !== "nric"),
        ...dirtyFields.filter((field) => field.key === "nric"),
      ];

      for (const field of fieldsToSave) {
        await onSaveField(
          member,
          field.key.startsWith("extra-") ? Number(field.key.replace("extra-", "")) : field.key,
          draftValues[field.key],
        );
      }
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Register Detail</div>
            <h3 style={titleStyle}>{member.name_cn || member.name || "成员资料"}</h3>
            <div style={subTitleStyle}>{member.nric || "-"}</div>
          </div>
          <div style={headerActionsStyle}>
            {dirtyFields.length ? <div style={dirtyBadgeStyle}>{`${dirtyFields.length} 项待保存`}</div> : null}
            <button type="button" style={closeButtonStyle} onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div style={summaryGridStyle}>
          <SummaryCard label="成员 ID" value={member.id} />
          <SummaryCard label="电话" value={formatDisplayValue(member.phone)} />
          <SummaryCard label="最后更新" value={formatDateTime(member.edit_at as string | null | undefined)} />
          <SummaryCard
            label="付款记录"
            value={`${payments.length} 笔`}
            accent={payments.length > 0}
          />
        </div>

        {saveError ? <div style={errorBannerStyle}>{saveError}</div> : null}

        <div style={twoColumnGridStyle}>
          <Section title="基本资料">
            {editableBaseFields.map((field) => (
              <EditRow
                key={field.key}
                field={field}
                value={draftValues[field.key] ?? normalizeFieldValue(field.value)}
                disabled={saving || readOnly}
                readOnly={readOnly}
                onChange={handleFieldChange}
              />
            ))}
          </Section>

          <Section
            title="附加资料"
            action={
              parentalFormEnabled ? (
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => {
                    void open_parental_form(parentalFormContext, member, member.parental_data || {}, true, true, {
                      onParentDataSync: onSaveField
                        ? (parentData: unknown) => onSaveField(member, "parental_data", parentData)
                        : undefined,
                    });
                  }}
                >
                  {parental ? "查看家长同意书" : "发给家长签名"}
                </button>
              ) : null
            }
          >
            <ReadItem label="Email" value={member.email} />
            <ReadItem label="可用时段" value={availableSlots.length ? `${availableSlots.length} 个时段` : "-"} />
            {parental ? (
              <div style={compactGridStyle}>
                <ReadItem label="家长中文名" value={parental.parent_cn} />
                <ReadItem label="家长电话" value={parental.parent_phone} />
                <ReadItem label="孩子中文名" value={parental.child_cn} />
                <ReadItem label="孩子 NRIC" value={parental.child_nric} />
                <ReadItem label="签名" value={parental.sign} />
                <ReadItem label="签名日期" value={parental.sign_date} />
              </div>
            ) : (
              <div style={emptyStateStyle}>没有家长同意书资料</div>
            )}
          </Section>
        </div>

        {availableSlots.length ? (
          <Section title="可用时间段">
            <div style={timelineListStyle}>
              {availableSlots.map((slot, index) => (
                <div key={`${slot.datetime || "start"}-${slot.end_datetime || "end"}-${index}`} style={timeSlotStyle}>
                  <div style={timeSlotIndexStyle}>{index + 1}</div>
                  <div style={timeSlotValueStyle}>{formatTimeSlot(slot)}</div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {editableExtraFields.length ? (
          <Section title="表格内容">
            {editableExtraFields.map((field) => (
              <EditRow
                key={field.key}
                field={field}
                value={draftValues[field.key] ?? normalizeFieldValue(field.value)}
                disabled={saving || readOnly}
                readOnly={readOnly}
                onChange={handleFieldChange}
              />
            ))}
          </Section>
        ) : null}

        <Section title="付款记录">
          {canManagePayments && effectiveFormId != null ? (
            <PaymentComposer
              formId={effectiveFormId}
              nric={String(member.nric || "")}
              fees={availableFees}
              canConfirm={canConfirmPayments}
              onCreated={(payment) => {
                setPayments((current) => [payment, ...current]);
                onPaymentChanged?.();
              }}
            />
          ) : null}
          {payments.length ? (
            <div style={paymentListStyle}>
              {payments.map((payment) => (
                <PaymentCard key={payment.id} payment={payment} />
              ))}
            </div>
          ) : (
            <div style={emptyStateStyle}>这个成员目前还没有付款记录</div>
          )}
        </Section>

        {editableFields.length ? (
          <div style={footerBarStyle}>
            <div style={footerHintStyle}>
              {readOnly
                ? "当前为只读模式，需要 form_edit 权限才能修改成员资料"
                : dirtyFields.length
                  ? `已修改 ${dirtyFields.length} 项资料`
                  : "没有未保存的修改"}
            </div>
            <div style={footerActionsStyle}>
              <button type="button" style={secondaryButtonStyle} onClick={onClose}>
                关闭
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  style={saveButtonStyle}
                  disabled={saving || !dirtyFields.length}
                  onClick={() => void handleSaveAll()}
                >
                  {saving ? "保存中" : "保存修改"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function normalizeCheckboxValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true" || value === "1";
  }
  return false;
}

function normalizeFieldValue(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function formatTimeSlot(slot: FormMemberTimeSlot) {
  const start = formatDateTime(slot.datetime);
  const end = formatDateTime(slot.end_datetime);
  if (start === "-" && end === "-") {
    return "-";
  }
  return `${start} -> ${end}`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPrice(value: unknown) {
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return formatDisplayValue(value);
  }
  return `RM ${amount.toFixed(2)}`;
}

function buildNricChangeConfirmMessage(preview: {
  old_nric?: string;
  new_nric?: string;
  mode?: "noop" | "update" | "merge";
  impact?: {
    registration_count?: number;
    version_count?: number;
    payment_count?: number;
    youth_registration_count?: number;
    parental_reference_count?: number;
    duplicate_registration_count?: number;
    merged_registration_count?: number;
  };
  message?: string;
  merge_target?: {
    id: number;
    nric: string;
    display_name: string;
  } | null;
}) {
  const impact = preview.impact || {};
  const registrationCount = impact.registration_count ?? 0;
  const versionCount = impact.version_count ?? 0;
  const paymentCount = impact.payment_count ?? 0;
  const youthRegistrationCount = impact.youth_registration_count ?? 0;
  const parentalReferenceCount = impact.parental_reference_count ?? 0;
  const duplicateRegistrationCount = impact.duplicate_registration_count ?? 0;
  const mergedRegistrationCount = impact.merged_registration_count ?? registrationCount;

  const lines = [
    `即将把 NRIC 从 ${preview.old_nric || "-"} 改成 ${preview.new_nric || "-"}`,
    preview.message || `本次修改将影响 ${registrationCount} 条报名数据`,
  ];

  if (preview.mode === "merge" && preview.merge_target) {
    lines.push(`将合并到成员 #${preview.merge_target.id} (${preview.merge_target.display_name})`);
    lines.push(`合并后报名总数: ${mergedRegistrationCount} 条`);
    if (duplicateRegistrationCount > 0) {
      lines.push(`其中重复报名: ${duplicateRegistrationCount} 条`);
    }
  }

  return [
    ...lines,
    `报名数据: ${registrationCount} 条`,
    `资料版本: ${versionCount} 条`,
    `付款记录: ${paymentCount} 笔`,
    `青少年班报名: ${youthRegistrationCount} 条`,
    `家长同意书引用: ${parentalReferenceCount} 条`,
    "确认继续保存吗？",
  ].join("\n");
}

function translatePaymentStatus(value: unknown) {
  if (value === "checked") {
    return "已确认";
  }
  if (value === "process") {
    return "处理中";
  }
  if (value === "fail") {
    return "失败";
  }
  return formatDisplayValue(value);
}

function getPaymentStatusMeta(value: unknown) {
  if (value === "checked") {
    return {
      label: translatePaymentStatus(value),
      textColor: colors.success,
      background: colors.successSoft,
    };
  }
  if (value === "fail") {
    return {
      label: translatePaymentStatus(value),
      textColor: colors.danger,
      background: colors.dangerSoft,
    };
  }
  return {
    label: translatePaymentStatus(value),
    textColor: colors.warning,
    background: colors.warningSoft,
  };
}

function formatDisplayValue(value: unknown) {
  if (value == null || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "-";
  }
  return String(value);
}

export function showRegisterDetail(options: ShowRegisterDetailOptions) {
  openOverlay((close) => <MemberDetailModal {...options} onClose={close} />);
}

const colors = designTokens.colors;
const radius = designTokens.radius;
const fonts = designTokens.fonts;

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px",
  background: colors.shadowStrong,
  backdropFilter: "blur(8px)",
};

const modalStyle: CSSProperties = {
  width: "min(980px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelStrongest,
  border: `1px solid ${colors.line}`,
  boxShadow: `0 12px 28px ${colors.shadow}`,
  fontFamily: fonts.sans,
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "flex-start",
  marginBottom: "8px",
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

const eyebrowStyle: CSSProperties = {
  marginBottom: "4px",
  fontSize: "11px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: colors.accent,
  fontWeight: 700,
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: colors.ink,
  fontSize: "18px",
  fontWeight: 900,
  lineHeight: 1.1,
};

const subTitleStyle: CSSProperties = {
  marginTop: "3px",
  color: colors.inkMuted,
  fontSize: "12px",
};

const closeButtonStyle: CSSProperties = {
  padding: "6px 9px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
  color: colors.ink,
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 700,
};

const dirtyBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 7px",
  borderRadius: "999px",
  background: colors.warningSoft,
  color: colors.warning,
  fontSize: "12px",
  fontWeight: 800,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: "6px",
  marginBottom: "8px",
};

const errorBannerStyle: CSSProperties = {
  marginBottom: "10px",
  padding: "8px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.danger}`,
  background: colors.dangerSoft,
  color: colors.danger,
  fontSize: "13px",
  fontWeight: 700,
};

const summaryCardStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const summaryCardAccentStyle: CSSProperties = {
  background: colors.accentSoft,
  border: `1px solid ${colors.accentBorder}`,
};

const summaryLabelStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "11px",
  marginBottom: "2px",
  fontWeight: 700,
};

const summaryValueStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "14px",
  fontWeight: 900,
};

const twoColumnGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: "6px",
  marginBottom: "6px",
};

const sectionStyle: CSSProperties = {
  marginBottom: "6px",
  padding: "8px",
  borderRadius: radius.sm,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  marginBottom: "6px",
};

const sectionTitleStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "14px",
  fontWeight: 900,
};

const sectionBodyStyle: CSSProperties = {
  display: "grid",
  gap: "5px",
};

const compactGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "5px",
};

const readItemStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const readLabelStyle: CSSProperties = {
  marginBottom: "3px",
  color: colors.inkMuted,
  fontSize: "11px",
  fontWeight: 700,
};

const readValueStyle: CSSProperties = {
  color: colors.ink,
  lineHeight: 1.35,
  wordBreak: "break-word",
  fontSize: "12px",
};

const editRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "96px minmax(0, 1fr) 48px",
  gap: "5px",
  alignItems: "start",
};

const editLabelStyle: CSSProperties = {
  color: colors.inkMuted,
  fontWeight: 700,
  fontSize: "11px",
  paddingTop: "8px",
};

const editControlWrapStyle: CSSProperties = {
  minWidth: 0,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "30px",
  padding: "5px 7px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
  color: colors.ink,
  boxSizing: "border-box",
  fontSize: "12px",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "72px",
};

const saveButtonStyle: CSSProperties = {
  padding: "6px 9px",
  borderRadius: radius.sm,
  border: "none",
  background: colors.accent,
  color: colors.panel,
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "12px",
  minWidth: "84px",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "6px 9px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
  color: colors.ink,
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "12px",
};

const checkboxWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  minHeight: "32px",
};

const editHintStyle: CSSProperties = {
  paddingTop: "8px",
  color: colors.inkMuted,
  fontSize: "10px",
  textAlign: "right",
};

const timelineListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const timeSlotStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "40px minmax(0, 1fr)",
  gap: "6px",
  alignItems: "center",
  padding: "7px 8px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const timeSlotIndexStyle: CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  background: colors.accent,
  color: colors.panel,
  fontSize: "12px",
  fontWeight: 800,
};

const timeSlotValueStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "13px",
};

const paymentListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const composerToggleStyle: CSSProperties = {
  width: "fit-content",
  padding: "6px 10px",
  borderRadius: radius.sm,
  border: `1px dashed ${colors.accentBorder}`,
  background: colors.accentSoft,
  color: colors.accent,
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 800,
};

const composerStyle: CSSProperties = {
  display: "grid",
  gap: "7px",
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.accentBorder}`,
};

const composerHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
};

const composerTitleStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "13px",
  fontWeight: 900,
};

const composerCloseStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
  color: colors.inkMuted,
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 700,
};

const composerFieldStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const composerLabelStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "11px",
  fontWeight: 700,
};

const composerErrorStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.danger}`,
  background: colors.dangerSoft,
  color: colors.danger,
  fontSize: "12px",
  fontWeight: 700,
};

const paymentCardStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const paymentMetaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "6px",
};

const paymentProofWrapStyle: CSSProperties = {
  marginTop: "8px",
  display: "grid",
  gap: "6px",
};

const subtleLabelStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
  fontWeight: 700,
};

const proofLinkStyle: CSSProperties = {
  width: "fit-content",
  color: colors.info,
  fontSize: "12px",
  fontWeight: 700,
  textDecoration: "none",
};

const paymentProofImageStyle: CSSProperties = {
  width: "100%",
  maxWidth: "360px",
  maxHeight: "360px",
  objectFit: "contain",
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.panel,
};

const emptyStateStyle: CSSProperties = {
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  color: colors.inkMuted,
  fontSize: "13px",
};

const statusBadgeStyle: CSSProperties = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
};

const footerBarStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  marginTop: "10px",
  padding: "8px 10px",
  borderRadius: radius.sm,
  background: colors.panelStrongest,
  border: `1px solid ${colors.line}`,
  boxShadow: "none",
};

const footerHintStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "13px",
  fontWeight: 600,
};

const footerActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};
