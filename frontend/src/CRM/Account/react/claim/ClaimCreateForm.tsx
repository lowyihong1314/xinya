import type { CSSProperties, ReactNode } from "react";

import {
  buttonGhostStyle,
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  chipStyle,
  fieldLabelStyle,
  fieldStyle,
  footerActionsStyle,
  formGridStyle,
  inputStyle,
  panelHeaderStyle,
  panelTitleStyle,
  sectionCardStyle,
  sectionTitleStyle,
  summaryRowStyle,
  textareaStyle,
  wideFieldStyle,
} from "./claimStyles";
import { AiFillPanel, type AiFillOutcome } from "./AiFillPanel";
import { LineItemsEditor } from "./LineItemsEditor";
import { lineItemsTotal, type LineItemDraft } from "./lineItems";
import type { AccountUser } from "./types";

// 报销申请的唯一输入布局：新建申请、活动预算弹窗、批量申请「信息」弹窗全部用这一份。
// 版块顺序：① 附件与签名 → ② 金额与关联 → ③ 申请信息 → ④ 用途说明 + 明细 → ⑤ 商家信息
export type CreateState = {
  applicant_name: string;
  request_date: string;
  department_name: string;
  acctDept: string;
  purpose: string;
  lineItems: LineItemDraft[];
  vendor_name: string;
  vendor_address: string;
  vendor_contact_number: string;
  purchase_datetime: string;
  selectedEvent: { id: number; event_name?: string } | null;
  files: File[];
  signJsonData: { strokes?: unknown[] } | null;
};

export const ACCT_DEPARTMENTS = ["法会", "心芽", "芽芽", "母会基建", "母会设备"];

type ClaimFormSectionsProps = {
  isMobile: boolean;
  state: CreateState;
  user: AccountUser | null;
  onChange: (value: CreateState | ((prev: CreateState) => CreateState)) => void;
  onPickEvent?: () => void;
  onSign?: () => void;
  // AI 读单（不传则不显示该面板）
  ai?: {
    parsing: boolean;
    canParse: boolean;
    onParse: (model: "auto" | "byteplus") => void;
    outcome: AiFillOutcome;
    error?: string | null;
    onUndo?: () => void;
    hideUpload?: boolean;
    note?: string;
  };
  lockedEvent?: boolean;
  budgetLine?: { id: number; category?: string } | null;
  /** 批量申请那边附件由卡片自己管，用这个槽位替换默认的上传/签名内容 */
  attachmentSlot?: ReactNode;
  showSign?: boolean;
};

export function ClaimFormSections({
  isMobile,
  state,
  user,
  onChange,
  onPickEvent,
  onSign,
  ai,
  lockedEvent = false,
  budgetLine = null,
  attachmentSlot,
  showSign = true,
}: ClaimFormSectionsProps) {
  const signed = !!state.signJsonData?.strokes?.length;
  const total = lineItemsTotal(state.lineItems);

  function patch(next: Partial<CreateState>) {
    onChange((prev) => ({ ...prev, ...next }));
  }

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      {/* ① 附件与签名 */}
      <Section title="① 附件与签名">
        {attachmentSlot}
        {ai ? (
          <AiFillPanel
            files={state.files}
            onFilesAdd={(files) => patch({ files: [...state.files, ...files] })}
            onFileRemove={(index) => patch({ files: state.files.filter((_, i) => i !== index) })}
            parsing={ai.parsing}
            canParse={ai.canParse}
            onParse={ai.onParse}
            outcome={ai.outcome}
            error={ai.error}
            onUndo={ai.onUndo}
            hideUpload={ai.hideUpload}
            note={ai.note}
          />
        ) : null}
        {showSign ? (
          <div className="claim-create-form__sign-row" style={summaryRowStyle}>
            <span
              style={{
                ...chipStyle,
                ...(signed ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" } : {}),
              }}
            >
              {signed ? "已签名" : "尚未签名"}
            </span>
            <button type="button" style={buttonSecondaryStyle} onClick={onSign}>
              {signed ? "重新签名" : "签名"}
            </button>
          </div>
        ) : null}
      </Section>

      {/* ② 金额与关联 */}
      <Section title="② 金额与关联">
        <div style={formGridStyle(isMobile)}>
          <Field label="金额 (RM)">
            <div style={amountBoxStyle}>
              <strong style={amountValueStyle}>RM {total.toFixed(2)}</strong>
              <span style={amountHintStyle}>由 ④ 用途明细自动合计</span>
            </div>
          </Field>
          <Field label="关联活动">
            <div className="claim-create-form__event-row" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {lockedEvent || !onPickEvent ? null : (
                <button type="button" style={buttonSecondaryStyle} onClick={onPickEvent}>
                  选择活动
                </button>
              )}
              <span style={chipStyle}>
                {state.selectedEvent
                  ? `${state.selectedEvent.event_name || "未命名活动"} #${state.selectedEvent.id}`
                  : "未关联活动"}
              </span>
            </div>
          </Field>
          {budgetLine ? (
            <Field label="关联预算行" wide>
              <span style={{ ...chipStyle, background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)" }}>
                预算 · {budgetLine.category || `#${budgetLine.id}`}
              </span>
            </Field>
          ) : null}
        </div>
      </Section>

      {/* ③ 申请信息 */}
      <Section title="③ 申请信息">
        <div style={formGridStyle(isMobile)}>
          <Field label="姓名">
            <input
              value={state.applicant_name}
              onChange={(event) => patch({ applicant_name: event.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="日期">
            <input
              type="date"
              value={state.request_date}
              onChange={(event) => patch({ request_date: event.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="部门">
            <select
              value={state.department_name}
              onChange={(event) => patch({ department_name: event.target.value })}
              style={inputStyle}
            >
              <option value="">请选择部门</option>
              {(user?.departments || []).map((department) => (
                <option key={department.id} value={department.name}>
                  {department.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="做账分配">
            <select value={state.acctDept} onChange={(event) => patch({ acctDept: event.target.value })} style={inputStyle}>
              <option value="">请选择</option>
              {ACCT_DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* ④ 用途说明 + 明细 */}
      <Section title="④ 用途说明与明细">
        <div style={{ display: "grid", gap: "10px" }}>
          <div style={fieldStyle}>
            <span style={fieldLabelStyle}>用途明细（每项一行，合计即申请金额）</span>
            <LineItemsEditor
              isMobile={isMobile}
              lines={state.lineItems}
              onChange={(lineItems) => patch({ lineItems })}
            />
          </div>
          <label style={{ ...fieldStyle, ...wideFieldStyle }}>
            <span style={fieldLabelStyle}>用途说明（补充说明，可留空）</span>
            <textarea
              rows={4}
              value={state.purpose}
              placeholder="例如：商家、收据号、AI 读单说明，或这笔支出的背景"
              onChange={(event) => patch({ purpose: event.target.value })}
              style={textareaStyle}
            />
          </label>
        </div>
      </Section>

      {/* ⑤ 商家信息 */}
      <Section title="⑤ 商家信息">
        <div style={formGridStyle(isMobile)}>
          <Field label="商家名称">
            <input value={state.vendor_name} onChange={(event) => patch({ vendor_name: event.target.value })} style={inputStyle} />
          </Field>
          <Field label="商家联络号码">
            <input
              value={state.vendor_contact_number}
              onChange={(event) => patch({ vendor_contact_number: event.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="商家地址" wide>
            <input value={state.vendor_address} onChange={(event) => patch({ vendor_address: event.target.value })} style={inputStyle} />
          </Field>
          <Field label="采购日期">
            <input
              type="datetime-local"
              value={state.purchase_datetime}
              onChange={(event) => patch({ purchase_datetime: event.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

type ClaimCreateFormProps = ClaimFormSectionsProps & {
  submitting: boolean;
  onBack: () => void;
  onSubmit: () => void;
  title?: string;
  backLabel?: string;
  submitLabel?: string;
};

export function ClaimCreateForm({
  submitting,
  onBack,
  onSubmit,
  title = "填写申请",
  backLabel = "返回列表",
  submitLabel = "提交申请",
  ...sectionProps
}: ClaimCreateFormProps) {
  const { user, state } = sectionProps;
  const total = lineItemsTotal(state.lineItems);

  return (
    <>
      <div className="claim-create-form__header" style={panelHeaderStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          {backLabel}
        </button>
        <div className="claim-create-form__title" style={panelTitleStyle}>{title}</div>
      </div>

      <div className="claim-create-form__summary" style={summaryRowStyle}>
        <span style={chipStyle}>账号：{user?.username || "—"}</span>
        {user?.email ? <span style={chipStyle}>Email：{user.email}</span> : null}
        {user?.phone ? <span style={chipStyle}>电话：{user.phone}</span> : null}
        <span style={{ ...chipStyle, background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", fontWeight: 800 }}>
          合计 RM {total.toFixed(2)}
        </span>
      </div>

      <ClaimFormSections {...sectionProps} />

      <div className="claim-create-form__footer" style={footerActionsStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          {backLabel}
        </button>
        <button type="button" style={buttonPrimaryStyle} onClick={onSubmit} disabled={submitting}>
          {submitting ? "提交中…" : `${submitLabel}（RM ${total.toFixed(2)}）`}
        </button>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={sectionCardStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </section>
  );
}

export function isReadableBillFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    /\.(jpe?g|png|webp|bmp|tiff?|pdf)$/i.test(file.name)
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label
      className={wide ? "claim-create-form__field claim-create-form__field--wide" : "claim-create-form__field"}
      style={wide ? { ...fieldStyle, ...wideFieldStyle } : fieldStyle}
    >
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

const amountBoxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: "8px 12px",
  borderRadius: "9px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};
const amountValueStyle: CSSProperties = { fontSize: "18px", fontWeight: 800, color: "var(--x-color-ink)" };
const amountHintStyle: CSSProperties = { fontSize: "11px", color: "var(--x-color-ink-muted)" };
