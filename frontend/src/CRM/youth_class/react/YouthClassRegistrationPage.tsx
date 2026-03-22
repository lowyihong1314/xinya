import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ChangeEvent, FormEvent } from "react";

const STORAGE_KEY = "utba.crm.youth-class-registration.drafts";

type FormState = {
  chineseName: string;
  englishName: string;
  gender: string;
  birthDate: string;
  age: string;
  phone: string;
  whatsapp: string;
  email: string;
  school: string;
  educationLevel: string;
  occupation: string;
  guardianName: string;
  guardianPhone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  buddhistExperience: string;
  learningGoals: string;
  medicalNotes: string;
  attendancePreference: string;
  availableTime: string;
  referralSource: string;
  remarks: string;
  agreeContact: boolean;
};

type SavedDraft = FormState & {
  id: string;
  submittedAt: string;
};

const initialForm: FormState = {
  chineseName: "",
  englishName: "",
  gender: "",
  birthDate: "",
  age: "",
  phone: "",
  whatsapp: "",
  email: "",
  school: "",
  educationLevel: "",
  occupation: "",
  guardianName: "",
  guardianPhone: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  buddhistExperience: "",
  learningGoals: "",
  medicalNotes: "",
  attendancePreference: "",
  availableTime: "",
  referralSource: "",
  remarks: "",
  agreeContact: true,
};

function loadDrafts(): SavedDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: SavedDraft[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function downloadJson(data: SavedDraft[]) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "youth-class-registrations.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function YouthClassRegistrationPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [notice, setNotice] = useState<string>("");

  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  const totalCount = drafts.length;
  const latestSubmission = useMemo(() => drafts[0]?.submittedAt ?? null, [drafts]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleTextChange(key: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "checkbox") {
        updateField(key, target.checked as FormState[typeof key]);
        return;
      }
      updateField(key, target.value as FormState[typeof key]);
    };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const record: SavedDraft = {
      ...form,
      id: `${Date.now()}`,
      submittedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };

    const nextDrafts = [record, ...drafts];
    setDrafts(nextDrafts);
    saveDrafts(nextDrafts);
    setForm(initialForm);
    setNotice("已保存到当前浏览器（前端暂存，尚未连接后台数据库）。");
  }

  function handleClearAll() {
    if (!window.confirm("确定要清空当前浏览器内已暂存的报名记录吗？")) {
      return;
    }
    setDrafts([]);
    saveDrafts([]);
    setNotice("本地暂存记录已清空。");
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>CRM / 报名表单</div>
          <h1 style={titleStyle}>青少年 & 青年佛学班报名表</h1>
          <p style={descStyle}>
            先提供前端填写与本地暂存版本，方便先看页面与字段。当前不会提交到后台数据库，也不会自动发通知。
          </p>
        </div>
        <div style={statsWrapStyle}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>本机暂存记录</div>
            <div style={statValueStyle}>{totalCount}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>最近保存</div>
            <div style={statSmallValueStyle}>{latestSubmission ?? "暂无"}</div>
          </div>
        </div>
      </section>

      {notice ? <div style={noticeStyle}>{notice}</div> : null}

      <div style={gridStyle}>
        <form style={panelStyle} onSubmit={handleSubmit}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>报名资料</h2>
            <p style={sectionHintStyle}>可先作为 UI 草稿使用，后面再接数据库/API。</p>
          </div>

          <div style={fieldsGridStyle}>
            <Field label="中文姓名 *"><input required value={form.chineseName} onChange={handleTextChange("chineseName")} style={inputStyle} /></Field>
            <Field label="英文姓名"><input value={form.englishName} onChange={handleTextChange("englishName")} style={inputStyle} /></Field>
            <Field label="性别"><select value={form.gender} onChange={handleTextChange("gender")} style={inputStyle}><option value="">请选择</option><option value="男">男</option><option value="女">女</option><option value="其他">其他</option></select></Field>
            <Field label="出生日期"><input type="date" value={form.birthDate} onChange={handleTextChange("birthDate")} style={inputStyle} /></Field>
            <Field label="年龄"><input value={form.age} onChange={handleTextChange("age")} style={inputStyle} /></Field>
            <Field label="联络电话 *"><input required value={form.phone} onChange={handleTextChange("phone")} style={inputStyle} /></Field>
            <Field label="WhatsApp"><input value={form.whatsapp} onChange={handleTextChange("whatsapp")} style={inputStyle} /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={handleTextChange("email")} style={inputStyle} /></Field>
            <Field label="学校 / 学院"><input value={form.school} onChange={handleTextChange("school")} style={inputStyle} /></Field>
            <Field label="年级 / 学历"><input value={form.educationLevel} onChange={handleTextChange("educationLevel")} style={inputStyle} /></Field>
            <Field label="职业"><input value={form.occupation} onChange={handleTextChange("occupation")} style={inputStyle} /></Field>
            <Field label="出席方式"><select value={form.attendancePreference} onChange={handleTextChange("attendancePreference")} style={inputStyle}><option value="">请选择</option><option value="实体">实体</option><option value="线上">线上</option><option value="都可以">都可以</option></select></Field>
          </div>

          <div style={subSectionTitleStyle}>监护人与紧急联络</div>
          <div style={fieldsGridStyle}>
            <Field label="监护人姓名"><input value={form.guardianName} onChange={handleTextChange("guardianName")} style={inputStyle} /></Field>
            <Field label="监护人电话"><input value={form.guardianPhone} onChange={handleTextChange("guardianPhone")} style={inputStyle} /></Field>
            <Field label="紧急联络人"><input value={form.emergencyContactName} onChange={handleTextChange("emergencyContactName")} style={inputStyle} /></Field>
            <Field label="紧急联络电话"><input value={form.emergencyContactPhone} onChange={handleTextChange("emergencyContactPhone")} style={inputStyle} /></Field>
          </div>

          <Field label="居住地址"><textarea rows={3} value={form.address} onChange={handleTextChange("address")} style={textareaStyle} /></Field>
          <Field label="学佛经历 / 接触佛法经验"><textarea rows={4} value={form.buddhistExperience} onChange={handleTextChange("buddhistExperience")} style={textareaStyle} /></Field>
          <Field label="报名原因 / 学习目标"><textarea rows={4} value={form.learningGoals} onChange={handleTextChange("learningGoals")} style={textareaStyle} /></Field>
          <Field label="可参与时段"><textarea rows={3} value={form.availableTime} onChange={handleTextChange("availableTime")} style={textareaStyle} /></Field>
          <Field label="健康状况 / 饮食 / 药物备注"><textarea rows={3} value={form.medicalNotes} onChange={handleTextChange("medicalNotes")} style={textareaStyle} /></Field>
          <Field label="从哪里得知课程"><input value={form.referralSource} onChange={handleTextChange("referralSource")} style={inputStyle} /></Field>
          <Field label="其他备注"><textarea rows={3} value={form.remarks} onChange={handleTextChange("remarks")} style={textareaStyle} /></Field>

          <label style={checkboxRowStyle}>
            <input type="checkbox" checked={form.agreeContact} onChange={handleTextChange("agreeContact")} />
            <span>我同意道场使用以上联络方式联系我，通知课程与活动资讯。</span>
          </label>

          <div style={actionRowStyle}>
            <button type="submit" style={primaryButtonStyle}>保存报名资料（本地）</button>
            <button type="button" style={secondaryButtonStyle} onClick={() => setForm(initialForm)}>重置表单</button>
          </div>
        </form>

        <aside style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>暂存记录</h2>
            <p style={sectionHintStyle}>仅保存在当前浏览器 localStorage。</p>
          </div>
          <div style={actionRowStyle}>
            <button type="button" style={secondaryButtonStyle} onClick={() => downloadJson(drafts)} disabled={!drafts.length}>导出 JSON</button>
            <button type="button" style={dangerButtonStyle} onClick={handleClearAll} disabled={!drafts.length}>清空暂存</button>
          </div>

          {drafts.length ? (
            <div style={draftListStyle}>
              {drafts.map((draft) => (
                <div key={draft.id} style={draftCardStyle}>
                  <div style={draftTitleRowStyle}>
                    <strong>{draft.chineseName || "未命名报名"}</strong>
                    <span style={draftTimeStyle}>{draft.submittedAt}</span>
                  </div>
                  <div style={draftMetaStyle}>电话：{draft.phone || "-"}</div>
                  <div style={draftMetaStyle}>出席方式：{draft.attendancePreference || "-"}</div>
                  <div style={draftMetaStyle}>学习目标：{draft.learningGoals || "-"}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyStyle}>还没有暂存记录。提交后会先显示在这里。</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

const pageStyle: CSSProperties = { display: "grid", gap: "20px" };
const heroStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.8fr) minmax(280px, 0.8fr)",
  gap: "16px",
  alignItems: "start",
};
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const titleStyle: CSSProperties = { margin: "8px 0 12px", fontSize: "32px", lineHeight: 1.15 };
const descStyle: CSSProperties = { margin: 0, lineHeight: 1.7, color: "var(--x-color-ink-muted)" };
const statsWrapStyle: CSSProperties = { display: "grid", gap: "12px" };
const statCardStyle: CSSProperties = { padding: "18px", borderRadius: "18px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)" };
const statLabelStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginBottom: "8px" };
const statValueStyle: CSSProperties = { fontSize: "34px", fontWeight: 800 };
const statSmallValueStyle: CSSProperties = { fontSize: "14px", lineHeight: 1.6 };
const noticeStyle: CSSProperties = { padding: "14px 16px", borderRadius: "14px", background: "var(--x-color-info-tint)", color: "var(--x-color-accent-strong)", border: "1px solid var(--x-color-info-border)" };
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.8fr)", gap: "18px", alignItems: "start" };
const panelStyle: CSSProperties = { padding: "22px", borderRadius: "22px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 18px 36px var(--x-color-shadow-soft)", display: "grid", gap: "16px" };
const sectionHeaderStyle: CSSProperties = { display: "grid", gap: "6px" };
const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: "22px" };
const sectionHintStyle: CSSProperties = { margin: 0, fontSize: "13px", color: "var(--x-color-ink-muted)", lineHeight: 1.6 };
const fieldsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" };
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const labelStyle: CSSProperties = { fontSize: "13px", fontWeight: 600, color: "var(--x-color-ink)" };
const inputStyle: CSSProperties = { width: "100%", borderRadius: "12px", border: "1px solid var(--x-color-line-soft)", padding: "11px 12px", background: "white", fontSize: "14px", boxSizing: "border-box" };
const textareaStyle: CSSProperties = { ...inputStyle, resize: "vertical", minHeight: "88px" };
const subSectionTitleStyle: CSSProperties = { fontSize: "15px", fontWeight: 700, marginTop: "4px" };
const checkboxRowStyle: CSSProperties = { display: "flex", alignItems: "start", gap: "10px", lineHeight: 1.6, fontSize: "14px" };
const actionRowStyle: CSSProperties = { display: "flex", gap: "12px", flexWrap: "wrap" };
const primaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "none", cursor: "pointer", fontWeight: 700, color: "white", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))" };
const secondaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", cursor: "pointer", fontWeight: 600, background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)" };
const dangerButtonStyle: CSSProperties = { ...secondaryButtonStyle, background: "#fff1f2", color: "#b42318", border: "1px solid #fecdd3" };
const draftListStyle: CSSProperties = { display: "grid", gap: "12px" };
const draftCardStyle: CSSProperties = { borderRadius: "16px", border: "1px solid var(--x-color-line-soft)", padding: "14px", background: "var(--x-color-panel-strong)", display: "grid", gap: "8px" };
const draftTitleRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "start" };
const draftTimeStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const draftMetaStyle: CSSProperties = { fontSize: "13px", color: "var(--x-color-ink-muted)", lineHeight: 1.6 };
const emptyStyle: CSSProperties = { borderRadius: "16px", border: "1px dashed var(--x-color-line-soft)", padding: "18px", color: "var(--x-color-ink-muted)", textAlign: "center" };
