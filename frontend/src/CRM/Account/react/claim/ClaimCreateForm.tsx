import type { ChangeEvent, ReactNode } from "react";

import {
  buttonGhostStyle,
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  chipStyle,
  fieldLabelStyle,
  fieldStyle,
  fileListStyle,
  footerActionsStyle,
  formGridStyle,
  inputStyle,
  panelHeaderStyle,
  panelTitleStyle,
  summaryRowStyle,
  textareaStyle,
  uploadBoxStyle,
  wideFieldStyle,
} from "./claimStyles";
import type { AccountUser } from "./types";

export type CreateState = {
  applicant_name: string;
  request_date: string;
  amount: string;
  department_name: string;
  acctDept: string;
  purpose: string;
  selectedEvent: { id: number; event_name?: string } | null;
  files: File[];
  signJsonData: { strokes?: unknown[] } | null;
};

const ACCT_DEPARTMENTS = ["法会", "心芽", "芽芽", "母会基建", "母会设备"];

type ClaimCreateFormProps = {
  isMobile: boolean;
  state: CreateState;
  user: AccountUser | null;
  submitting: boolean;
  onBack: () => void;
  onChange: (value: CreateState | ((prev: CreateState) => CreateState)) => void;
  onPickEvent: () => void;
  onSign: () => void;
  onSubmit: () => void;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function ClaimCreateForm({
  isMobile,
  state,
  user,
  submitting,
  onBack,
  onChange,
  onPickEvent,
  onSign,
  onSubmit,
  onFilesChange,
}: ClaimCreateFormProps) {
  return (
    <div className="claim-create-form" style={{ display: "grid", gap: "16px" }}>
      <div className="claim-create-form__header" style={panelHeaderStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          返回列表
        </button>
        <div className="claim-create-form__title" style={panelTitleStyle}>填写申请</div>
      </div>

      <div className="claim-create-form__summary" style={summaryRowStyle}>
        <span style={chipStyle}>账号：{user?.username || "—"}</span>
        {user?.email ? <span style={chipStyle}>Email：{user.email}</span> : null}
        {user?.phone ? <span style={chipStyle}>电话：{user.phone}</span> : null}
      </div>

      <div className="claim-create-form__grid" style={formGridStyle(isMobile)}>
        <Field label="姓名">
          <input
            value={state.applicant_name}
            onChange={(event) => onChange((prev) => ({ ...prev, applicant_name: event.target.value }))}
            style={inputStyle}
          />
        </Field>
        <Field label="日期">
          <input
            type="date"
            value={state.request_date}
            onChange={(event) => onChange((prev) => ({ ...prev, request_date: event.target.value }))}
            style={inputStyle}
          />
        </Field>
        <Field label="金额">
          <input
            type="number"
            inputMode="decimal"
            value={state.amount}
            onChange={(event) => onChange((prev) => ({ ...prev, amount: event.target.value }))}
            style={inputStyle}
          />
        </Field>
        <Field label="部门">
          <select
            value={state.department_name}
            onChange={(event) => onChange((prev) => ({ ...prev, department_name: event.target.value }))}
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
          <select
            value={state.acctDept}
            onChange={(event) => onChange((prev) => ({ ...prev, acctDept: event.target.value }))}
            style={inputStyle}
          >
            <option value="">请选择</option>
            {ACCT_DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </Field>
        <Field label="关联活动">
          <div className="claim-create-form__event-row" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={buttonSecondaryStyle} onClick={onPickEvent}>
              选择活动
            </button>
            <span style={chipStyle}>
              {state.selectedEvent
                ? `${state.selectedEvent.event_name || "未命名活动"} #${state.selectedEvent.id}`
                : "未关联活动"}
            </span>
          </div>
        </Field>
        <Field label="用途说明" wide>
          <textarea
            rows={5}
            value={state.purpose}
            onChange={(event) => onChange((prev) => ({ ...prev, purpose: event.target.value }))}
            style={textareaStyle}
          />
        </Field>
        <Field label="附件" wide>
          <div className="claim-create-form__upload" style={uploadBoxStyle}>
            <input type="file" accept="image/*,application/pdf" multiple onChange={onFilesChange} />
            <div className="claim-create-form__file-list" style={fileListStyle}>
              {state.files.length
                ? state.files.map((file) => `${file.name} (${Math.round(file.size / 1024)} KB)`).join(" / ")
                : "未选择文件"}
            </div>
          </div>
        </Field>
      </div>

      <div className="claim-create-form__sign-row" style={summaryRowStyle}>
        <span style={chipStyle}>{state.signJsonData?.strokes?.length ? "已签名" : "尚未签名"}</span>
        <button type="button" style={buttonSecondaryStyle} onClick={onSign}>
          {state.signJsonData?.strokes?.length ? "重新签名" : "签名"}
        </button>
      </div>

      <div className="claim-create-form__footer" style={footerActionsStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          返回列表
        </button>
        <button type="button" style={buttonPrimaryStyle} onClick={onSubmit} disabled={submitting}>
          {submitting ? "提交中…" : "提交申请"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={wide ? "claim-create-form__field claim-create-form__field--wide" : "claim-create-form__field"} style={wide ? { ...fieldStyle, ...wideFieldStyle } : fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}
