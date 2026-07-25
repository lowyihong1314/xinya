import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import QRCode from "qrcode";

import { API_BASE } from "../../../js/apiBase";
import { CachedImage } from "../../../components/CachedMedia";
import { downloadBlobOrShare } from "../../../js/browserActions";
import { smartImageURL } from "../../../js/get_img";
import { calcAgeFromNric } from "../../../js/nric";
import { fetchGroupScoreLog, type GroupScoreLogEntry } from "./api";
import { AttendanceTab } from "./AttendanceTab";
import { FormAgentTab } from "./FormAgentTab";
import { ExtraFieldEditor } from "./ExtraFieldEditor";
import { FeePanel } from "./FeePanel";
import { TablePagination, usePagedRows } from "../../shared/TablePagination";
import { sortArrow, sortRows, sortableThStyle, toggleSort, type SortState } from "../../Account/react/shared/tableSort";
import type { ExtraFieldDraft } from "./ExtraFieldEditor";
import type { ExtraFieldConfig, FormCreatePayload, FormEvent, FormFee, FormGroup, FormMember, FormRecord, GroupChatMessage, GroupPlan } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;
const PUBLIC_ORIGIN = "https://utbabuddha.com";

type FeePayload = {
  category: string;
  amount: string;
  age_range_from?: string;
  age_range_to?: string;
  description?: string;
  image_path?: string | null;
};

const TABS: { key: string; label: string; icon: string }[] = [
  { key: "members", label: "报名成员", icon: "fa-solid fa-users" },
  { key: "groups", label: "分组", icon: "fa-solid fa-layer-group" },
  { key: "agent", label: "AI 助手", icon: "fa-solid fa-robot" },
  { key: "attendance", label: "点名", icon: "fa-solid fa-clipboard-check" },
  { key: "fees", label: "报名费", icon: "fa-solid fa-receipt" },
  { key: "fields", label: "表格内容", icon: "fa-solid fa-list-check" },
  { key: "settings", label: "基本设置", icon: "fa-solid fa-sliders" },
  { key: "public", label: "公开报名页", icon: "fa-solid fa-arrow-up-right-from-square" },
];

function normalizeExtraFieldDraft(draft: ExtraFieldDraft, index: number): ExtraFieldDraft {
  const label = draft.label.trim().replace(/\s+/g, " ");
  return { ...draft, label, order: draft.order ?? index };
}

function sanitizeFilenamePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "form";
}

async function exportMembersToExcel(formTitle: string, members: FormMember[], extraFields: ExtraFieldConfig[], isMobile: boolean) {
  const XLSX = await import("xlsx");
  const rows = members.map((member) => {
    const values = member.extra_fields || member.field_values || [];
    const row: Record<string, unknown> = {
      ID: member.id,
      报名时间: formatRegDatetime(member.registered_at),
      中文名: member.name_cn || "",
      英文名: member.name || "",
      NRIC: member.nric || "",
      年龄: calcAgeFromNric(member.nric) ?? "",
      电话: member.phone || "",
      Email: member.email || "",
      性别: member.gender || "",
      居住地址: member.address || "",
      医疗备注: member.medical || "",
      过敏: member.allergy || "",
      其他备注: member.other_remark || "",
      家长1: member.parent_1 || "",
      家长1电话: member.parent_1_phone || "",
      家长2: member.parent_2 || "",
      家长2电话: member.parent_2_phone || "",
      可用时段: Array.isArray(member.available_time_slot_json)
        ? member.available_time_slot_json
            .map((slot) => [slot.datetime || "", slot.end_datetime || ""].filter(Boolean).join(" ~ "))
            .filter(Boolean)
            .join(" | ")
        : "",
    };
    extraFields.forEach((field) => {
      const match = values.find((item) => item.field_config_id === field.id);
      row[field.label] = formatExtraFieldValue(match?.field_value);
    });
    return row;
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 提示: "暂无报名成员" }]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Members");
  const filename = `${sanitizeFilenamePart(formTitle)}_members.xlsx`;
  const workbookArray = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await downloadBlobOrShare(
    new Blob([workbookArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
    { isMobile, title: filename, text: `${formTitle} 报名成员 Excel` },
  );
}

function getEnabledFieldSwitchCount(form: FormRecord) {
  return [
    form.field_switches?.email ?? form.email,
    form.field_switches?.parental_form ?? form.parental_form,
    form.field_switches?.parent_1 ?? form.parent_1,
    form.field_switches?.parent_2 ?? form.parent_2,
    form.field_switches?.address ?? form.address,
    form.field_switches?.medical ?? form.medical,
    form.field_switches?.allergy ?? form.allergy,
    form.field_switches?.other_remark ?? form.other_remark,
  ].filter(Boolean).length;
}

function buildMemberSearchText(member: FormMember, extraFields: ExtraFieldConfig[]) {
  const values = member.extra_fields || member.field_values || [];
  const extraFieldText = extraFields
    .map((field) => {
      const match = values.find((item) => item.field_config_id === field.id);
      return [field.label, formatExtraFieldValue(match?.field_value)].join(" ");
    })
    .join(" ");
  return [
    member.id, member.name_cn, member.name, member.nric, member.phone, member.email, member.gender,
    member.address, member.parent_1, member.parent_1_phone, member.parent_2, member.parent_2_phone,
    member.medical, member.allergy, member.other_remark, extraFieldText,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function formatExtraFieldValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.join(", ") || "-";
  return String(value);
}

function memberPaymentMeta(member: FormMember) {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  const latest = payments[0];
  if (!latest) return { label: "未付款", tone: "muted" as const };
  if (latest.status === "checked") return { label: "已付款", tone: "success" as const };
  if (latest.status === "fail") return { label: "付款失败", tone: "danger" as const };
  return { label: "处理中", tone: "warning" as const };
}

// 家长同意书状态：需要（未成年 + 表单启用）而未完成 → 待完成；否则 不需要 / 已完成。
function memberParentalMeta(member: FormMember, parentalEnabled: boolean) {
  const age = calcAgeFromNric(member.nric);
  const required = parentalEnabled && age != null && age < 19;
  if (!required) return { label: "不需要", tone: "muted" as const };
  return member.parental_data
    ? { label: "已完成", tone: "success" as const }
    : { label: "待完成", tone: "danger" as const };
}

function formatRegDatetime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getMemberSortValue(member: FormMember, key: string): number | string | null {
  switch (key) {
    case "name":
      return member.name_cn || member.name || "";
    case "phone":
      return member.phone || "";
    case "gender":
      return String(member.gender || "");
    case "nric":
      return String(member.nric || "");
    case "age": {
      const age = calcAgeFromNric(member.nric);
      return age == null ? Number.NEGATIVE_INFINITY : age;
    }
    case "pay":
      return memberPaymentMeta(member).label;
    case "parental": {
      if (member.parental_data) return 2;
      const age = calcAgeFromNric(member.nric);
      return age != null && age < 19 ? 1 : 0;
    }
    case "registered_at":
      return member.registered_at || "";
    default:
      return null;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function FormWorkspaceView(props: {
  isMobile?: boolean;
  canReadForms: boolean;
  canEditForms: boolean;
  canViewMemberDetail: boolean;
  canEditMembers: boolean;
  forms: FormRecord[];
  selectedForm: FormRecord | null;
  selectedFormId: number | null;
  activeTab: string;
  fees: FormFee[];
  extraFields: ExtraFieldConfig[];
  groups: FormGroup[];
  loading: boolean;
  detailLoading: boolean;
  createOpen: boolean;
  toast: Toast;
  onSelectForm: (formId: number) => void;
  onBackToList: () => void;
  onSelectTab: (tab: string) => void;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onCreateForm: (payload: FormCreatePayload) => void;
  onDeleteForm: (formId: number) => void;
  onPatchForm: (patch: Partial<FormRecord>) => void;
  onAddFee: (payload: FeePayload) => void;
  onEditFee: (feeId: number, payload: FeePayload) => void;
  onDeleteFee: (feeId: number) => void;
  onAddExtraField: (payload: ExtraFieldDraft) => void;
  onEditExtraField: (fieldId: number, payload: ExtraFieldDraft) => void;
  onDeleteExtraField: (fieldId: number) => void;
  onPickEvent: () => void;
  onOpenEventDetail: (eventId: number) => void;
  onRemoveEvent: (eventId: number) => void;
  onRemoveMember: (memberId: number) => void;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (groupId: number, name: string) => void;
  onDeleteGroup: (groupId: number) => void;
  onAssignMemberGroup: (memberId: number, groupId: number | null) => void;
  onAdjustGroupScore: (groupId: number, delta: number) => void;
  onCreateScorePanel: () => Promise<string | null>;
  onSetGroupColor: (groupId: number, color: string | null) => void;
  onSetGroupLeader: (groupId: number, memberId: number | null) => void;
  onAiChat: (messages: GroupChatMessage[]) => Promise<{ job_id?: string; room?: string }>;
  onApplyAiPlan: (plan: GroupPlan) => void;
  onShowMemberDetail: (member: FormMember) => void;
  onOpenParental: (member: FormMember) => void;
  onRefresh: () => void;
}) {
  const isMobile = props.isMobile ?? false;
  const { selectedForm, selectedFormId, activeTab } = props;
  const formsPaged = usePagedRows(props.forms);

  if (!props.canReadForms) {
    return (
      <div style={pageStyle}>
        <style>{TABLE_CSS}</style>
        <section style={panelStyle}>
          <div style={emptyStyle}>没有报名表工作台权限（需要 form_read / form_edit / member_detail 其中之一）。</div>
        </section>
      </div>
    );
  }

  // -------- Detail view --------
  if (selectedFormId != null) {
    return (
      <div style={pageStyle}>
        <style>{TABLE_CSS}</style>
        <section style={panelStyle}>
          <div style={headerStyle(isMobile)}>
            <div style={headerLeftStyle}>
              <button type="button" style={btnStyle} onClick={props.onBackToList}>
                ← 返回列表
              </button>
              <div>
                <div style={eyebrowStyle}>特别活动表 #{selectedFormId}</div>
                <h2 style={panelTitleStyle}>{selectedForm?.title || (props.detailLoading ? "加载中…" : `表格 #${selectedFormId}`)}</h2>
                {selectedForm ? (
                  <div style={linkedHeadRowStyle}>
                    <span style={mutedStyle}>截止 {selectedForm.expired || "-"} · 成员 {selectedForm.member_count ?? (selectedForm.members || []).length}</span>
                    {(selectedForm.events || []).map((event) => (
                      <LinkedEventHeadChip
                        key={event.id}
                        event={event}
                        canEditForms={props.canEditForms}
                        onOpen={() => props.onOpenEventDetail(event.id)}
                        onRemove={() => props.onRemoveEvent(event.id)}
                      />
                    ))}
                    {!(selectedForm.events || []).length ? <span style={mutedStyle}>未关联</span> : null}
                    {props.canEditForms ? (
                      <button type="button" style={linkedAddBtnStyle} onClick={props.onPickEvent}>+ 选择活动</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={headerRightStyle(isMobile)}>
              <button type="button" style={btnStyle} onClick={props.onRefresh}>刷新</button>
              {props.canEditForms && selectedForm ? (
                <button type="button" style={dangerButtonStyle} onClick={() => props.onDeleteForm(selectedForm.id)}>删除表格</button>
              ) : null}
            </div>
          </div>

          {props.toast ? <div style={props.toast.type === "success" ? successStyle : errorStyle}>{props.toast.text}</div> : null}

          <div style={tabBarWrapStyle}>
            <div style={tabBarStyle}>
              {TABS.map((tab) => (
                <button key={tab.key} type="button" style={tab.key === activeTab ? tabActiveStyle : tabStyle} onClick={() => props.onSelectTab(tab.key)}>
                  <i className={tab.icon} style={{ fontSize: "13px" }} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {!selectedForm ? (
            <div style={emptyStyle}>{props.detailLoading ? "正在加载详细资料…" : "找不到这个报名表，可能已被删除或数据已刷新。"}</div>
          ) : (
            <div style={bodyStyle}>
              {activeTab === "members" ? (
                <MembersTab
                  form={selectedForm}
                  extraFields={props.extraFields}
                  isMobile={isMobile}
                  canViewMemberDetail={props.canViewMemberDetail}
                  canEditMembers={props.canEditMembers}
                  onShowMemberDetail={props.onShowMemberDetail}
                  onOpenParental={props.onOpenParental}
                  onRemoveMember={props.onRemoveMember}
                />
              ) : null}

              {activeTab === "groups" ? (
                <GroupsTab
                  form={selectedForm}
                  groups={props.groups}
                  isMobile={isMobile}
                  canViewMemberDetail={props.canViewMemberDetail}
                  canEdit={props.canEditForms}
                  onCreateGroup={props.onCreateGroup}
                  onRenameGroup={props.onRenameGroup}
                  onDeleteGroup={props.onDeleteGroup}
                  onAssignMemberGroup={props.onAssignMemberGroup}
                  onAdjustGroupScore={props.onAdjustGroupScore}
                  onCreateScorePanel={props.onCreateScorePanel}
                  onSetGroupColor={props.onSetGroupColor}
                  onSetGroupLeader={props.onSetGroupLeader}
                  onAiChat={props.onAiChat}
                  onApplyAiPlan={props.onApplyAiPlan}
                />
              ) : null}

              {activeTab === "agent" ? (
                <FormAgentTab
                  formId={selectedForm.id}
                  canEdit={props.canEditForms}
                  isMobile={isMobile}
                  onApplied={props.onRefresh}
                />
              ) : null}

              {activeTab === "attendance" ? (
                props.canViewMemberDetail ? (
                  <AttendanceTab
                    formId={selectedForm.id}
                    members={selectedForm.members || []}
                    isMobile={isMobile}
                    canDelete={props.canEditForms}
                    parentalEnabled={Boolean(selectedForm.field_switches?.parental_form ?? selectedForm.parental_form)}
                  />
                ) : (
                  <div style={emptyInlineStyle}>需要 member_detail 或 form_edit 权限才能点名。</div>
                )
              ) : null}

              {activeTab === "fees" ? (
                <FeePanel
                  formId={selectedForm.id}
                  fees={props.fees}
                  readOnly={!props.canEditForms}
                  onAdd={props.onAddFee}
                  onEdit={props.onEditFee}
                  onDelete={props.onDeleteFee}
                />
              ) : null}

              {activeTab === "fields" ? (
                <div style={sectionBodyStyle}>
                  <div style={mutedStyle}>
                    中文姓名、英文姓名、NRIC、年龄、性别、邮箱、居住地址、医疗备注、过敏备注已经默认存在表格里。紧急联络人、交通等个别事项请在这里增添。
                  </div>
                  <ExtraFieldPanel
                    fields={props.extraFields}
                    readOnly={!props.canEditForms}
                    onAdd={props.onAddExtraField}
                    onEdit={props.onEditExtraField}
                    onDelete={props.onDeleteExtraField}
                  />
                </div>
              ) : null}

              {activeTab === "settings" ? (
                <SettingsTab form={selectedForm} isMobile={isMobile} canEdit={props.canEditForms} onPatchForm={props.onPatchForm} />
              ) : null}

              {activeTab === "public" ? (
                <PublicTab formId={selectedForm.id} isMobile={isMobile} />
              ) : null}
            </div>
          )}
        </section>

        {props.createOpen && props.canEditForms ? <CreateFormModal onClose={props.onCloseCreate} onSubmit={props.onCreateForm} /> : null}
      </div>
    );
  }

  // -------- List view --------
  return (
    <div style={pageStyle}>
      <style>{TABLE_CSS}</style>
      <section style={panelStyle}>
        <div style={toolbarStyle(isMobile)}>
          <div>
            <div style={eyebrowStyle}>CRM / 报名表</div>
            <h2 style={panelTitleStyle}>特别活动表格</h2>
            <div style={mutedStyle}>共 {props.forms.length} 个报名表</div>
          </div>
          <div style={headerRightStyle(isMobile)}>
            <button type="button" style={btnStyle} onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "刷新中…" : "刷新"}</button>
            {props.canEditForms ? (
              <button type="button" style={primaryButtonStyle} onClick={props.onOpenCreate}>新建表格</button>
            ) : null}
          </div>
        </div>

        {props.toast ? <div style={props.toast.type === "success" ? successStyle : errorStyle}>{props.toast.text}</div> : null}

        {props.loading ? <div style={emptyStyle}>加载报名表中…</div> : null}
        {!props.loading && !props.forms.length ? <div style={emptyStyle}>暂无报名表。</div> : null}
        {!props.loading && props.forms.length ? (
          <div style={{ display: "grid", gap: "8px", padding: "12px 14px 4px" }}>
          <TablePagination page={formsPaged.page} totalPages={formsPaged.totalPages} total={formsPaged.total} onPage={formsPaged.setPage} />
          <div style={tableWrapStyle}>
            <table className="fw-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>截止日期</th>
                  <th>报名人数</th>
                  <th>关联活动</th>
                  <th>报名费</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {formsPaged.pageRows.map((form) => {
                  const events = form.events || [];
                  return (
                    <tr key={form.id} className="fw-row" onClick={() => props.onSelectForm(form.id)}>
                      <td>
                        <div style={cellStrongStyle}>{form.title}</div>
                        <div style={cellSubStyle}>#{form.id}</div>
                      </td>
                      <td style={monoCellStyle}>{form.expired || "—"}</td>
                      <td>{form.member_count ?? (form.members || []).length}</td>
                      <td>{events.length ? `${events[0]?.event_name || `活动 #${events[0]?.id}`}${events.length > 1 ? ` +${events.length - 1}` : ""}` : "—"}</td>
                      <td>{(form.fees || []).length} 项</td>
                      <td style={monoCellStyle}>{form.created_at ? form.created_at.replace("T", " ").slice(0, 16) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        ) : null}
      </section>

      {props.createOpen && props.canEditForms ? <CreateFormModal onClose={props.onCloseCreate} onSubmit={props.onCreateForm} /> : null}
    </div>
  );
}

function MembersTab({
  form,
  extraFields,
  isMobile,
  canViewMemberDetail,
  canEditMembers,
  onShowMemberDetail,
  onOpenParental,
  onRemoveMember,
}: {
  form: FormRecord;
  extraFields: ExtraFieldConfig[];
  isMobile: boolean;
  canViewMemberDetail: boolean;
  canEditMembers: boolean;
  onShowMemberDetail: (member: FormMember) => void;
  onOpenParental: (member: FormMember) => void;
  onRemoveMember: (memberId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [portalMember, setPortalMember] = useState<FormMember | null>(null);
  const members = form.members || [];
  const parentalFormEnabled = Boolean(form.field_switches?.parental_form ?? form.parental_form);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const base = keyword
      ? members.filter((member) => buildMemberSearchText(member, extraFields).includes(keyword))
      : members;
    return sortRows(base, sort, getMemberSortValue);
  }, [members, extraFields, query, sort]);
  const paged = usePagedRows(filtered, undefined, `${query}|${sort?.key ?? ""}|${sort?.dir ?? ""}`);

  if (!canViewMemberDetail) {
    return (
      <div style={emptyInlineStyle}>
        这个表单目前共有 {form.member_count ?? members.length} 位报名成员。需要 member_detail 或 form_edit 权限才能查看详细资料。
      </div>
    );
  }

  return (
    <div style={memberLayoutStyle(isMobile)}>
      <div style={memberMainStyle}>
      <div style={memberToolbarStyle}>
        <input type="search" placeholder="搜索姓名、NRIC、电话、Email、家长或表格内容" value={query} onChange={(e) => setQuery(e.target.value)} style={searchInputStyle} />
        <button
          type="button"
          style={btnStyle}
          onClick={() => void exportMembersToExcel(form.title, members, extraFields, isMobile)}
        >
          下载 Excel
        </button>
      </div>
      {!members.length ? <div style={emptyInlineStyle}>暂无报名成员。</div> : null}
      {members.length && !filtered.length ? <div style={emptyInlineStyle}>没有匹配的报名成员。</div> : null}
      {filtered.length ? (
        <>
        <TablePagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPage={paged.setPage} />
        <div style={tableWrapStyle}>
          <table className="fw-table">
            <thead>
              <tr>
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "name"))}>姓名{sortArrow(sort, "name")}</th>
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "phone"))}>电话{sortArrow(sort, "phone")}</th>
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "gender"))}>性别{sortArrow(sort, "gender")}</th>
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "nric"))}>NRIC{sortArrow(sort, "nric")}</th>
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "age"))}>年龄{sortArrow(sort, "age")}</th>
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "pay"))}>付款状态{sortArrow(sort, "pay")}</th>
                {parentalFormEnabled ? (
                  <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "parental"))}>家长同意书{sortArrow(sort, "parental")}</th>
                ) : null}
                <th style={sortableThStyle} onClick={() => setSort((s) => toggleSort(s, "registered_at"))}>报名时间{sortArrow(sort, "registered_at")}</th>
                <th style={{ width: isMobile ? 150 : 200 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((member) => {
                const pay = memberPaymentMeta(member);
                const parental = memberParentalMeta(member, parentalFormEnabled);
                return (
                  <tr key={member.id} className="fw-row" onClick={() => onShowMemberDetail(member)}>
                    <td>
                      <div style={cellStrongStyle}>{member.name_cn || member.name || `成员 #${member.id}`}</div>
                      <div style={cellSubStyle}>{member.email || ""}</div>
                    </td>
                    <td style={monoCellStyle}>{member.phone || "—"}</td>
                    <td>{String(member.gender || "—")}</td>
                    <td style={monoCellStyle}>{String(member.nric || "—")}</td>
                    <td style={monoCellStyle}>{calcAgeFromNric(member.nric) ?? "—"}</td>
                    <td><span style={chipStyle(pay.tone)}>{pay.label}</span></td>
                    {parentalFormEnabled ? (
                      <td><span style={chipStyle(parental.tone)}>{parental.label}</span></td>
                    ) : null}
                    <td style={monoCellStyle}>{formatRegDatetime(member.registered_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={actionsCellStyle}>
                        {member.nric ? (
                          <button type="button" className="fw-btn" onClick={() => setPortalMember(member)} title="成员终端预览">终端</button>
                        ) : null}
                        {parentalFormEnabled || member.parental_data ? (
                          <button type="button" className="fw-btn" onClick={() => onOpenParental(member)}>
                            {member.parental_data ? "家长书" : "发家长"}
                          </button>
                        ) : null}
                        {canEditMembers ? (
                          <button type="button" className="fw-btn fw-btn--danger" onClick={() => onRemoveMember(member.id)}>移除</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : null}
      </div>
      {portalMember ? (
        <MemberTerminalDock formId={form.id} member={portalMember} isMobile={isMobile} onClose={() => setPortalMember(null)} />
      ) : null}
    </div>
  );
}

function MemberTerminalDock({ formId, member, isMobile, onClose }: { formId: number; member: FormMember; isMobile: boolean; onClose: () => void }) {
  const url = `${PUBLIC_ORIGIN}/api/form/member?form_id=${formId}&nric=${encodeURIComponent(String(member.nric || ""))}`;
  const [copied, setCopied] = useState("");
  async function copy() {
    const ok = await copyToClipboard(url);
    setCopied(ok ? "链接已复制" : "复制失败，请手动复制");
    window.setTimeout(() => setCopied(""), 2000);
  }
  return (
    <aside style={terminalDockStyle(isMobile)}>
      <div style={publicHeadStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>成员终端 · 手机预览</div>
          <h4 style={panelTitleStyle}>{member.name_cn || member.name || `成员 #${member.id}`}</h4>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button type="button" style={primaryButtonStyle} onClick={() => void copy()}>复制链接</button>
          <button type="button" style={btnStyle} onClick={onClose}>关闭</button>
        </div>
      </div>
      {copied ? <div style={successStyle}>{copied}</div> : null}
      <div style={urlBoxStyle}>{url}</div>
      <PhoneFrame src={url} title="成员终端预览" />
    </aside>
  );
}

const memberMainStyle: CSSProperties = { flex: 1, minWidth: 0, display: "grid", gap: "10px" };
function memberLayoutStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", flexDirection: isMobile ? "column" : "row", gap: "14px", alignItems: "flex-start", width: "100%" };
}
function terminalDockStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "100%" : "min(400px, 40vw)",
    flexShrink: 0,
    position: isMobile ? "static" : "sticky",
    top: "12px",
    alignSelf: "flex-start",
    maxHeight: isMobile ? "none" : "calc(100vh - 24px)",
    overflowY: "auto",
    display: "grid",
    gap: "12px",
    padding: "14px",
    boxSizing: "border-box",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    borderRadius: "14px",
    boxShadow: "0 20px 50px var(--x-color-shadow-soft)",
  };
}

// 自动命名：取现有「小组N」里最大的 N + 1（重命名过的组不影响编号）。
function nextGroupName(groups: FormGroup[]): string {
  let max = 0;
  for (const g of groups) {
    const m = /^小组(\d+)$/.exec((g.name || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `小组${max + 1}`;
}

function GroupsTab({
  form,
  groups,
  isMobile,
  canViewMemberDetail,
  canEdit,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onAssignMemberGroup,
  onAdjustGroupScore,
  onCreateScorePanel,
  onSetGroupColor,
  onSetGroupLeader,
  onAiChat,
  onApplyAiPlan,
}: {
  form: FormRecord;
  groups: FormGroup[];
  isMobile: boolean;
  canViewMemberDetail: boolean;
  canEdit: boolean;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (groupId: number, name: string) => void;
  onDeleteGroup: (groupId: number) => void;
  onAssignMemberGroup: (memberId: number, groupId: number | null) => void;
  onAdjustGroupScore: (groupId: number, delta: number) => void;
  onCreateScorePanel: () => Promise<string | null>;
  onSetGroupColor: (groupId: number, color: string | null) => void;
  onSetGroupLeader: (groupId: number, memberId: number | null) => void;
  onAiChat: (messages: GroupChatMessage[]) => Promise<{ job_id?: string; room?: string }>;
  onApplyAiPlan: (plan: GroupPlan) => void;
}) {
  const [dragOver, setDragOver] = useState<number | "ungrouped" | null>(null);
  const [panelUrl, setPanelUrl] = useState<string | null>(null);
  const [logGroup, setLogGroup] = useState<{ id: number; name: string } | null>(null);
  const members = form.members || [];

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id),
    [groups],
  );

  const byGroup = useMemo(() => {
    const validIds = new Set(sortedGroups.map((g) => g.id));
    const map = new Map<number | null, FormMember[]>();
    map.set(null, []);
    sortedGroups.forEach((g) => map.set(g.id, []));
    members.forEach((m) => {
      const gid = (m.group_id ?? null) as number | null;
      const key = gid != null && validIds.has(gid) ? gid : null;
      (map.get(key) as FormMember[]).push(m);
    });
    return map;
  }, [members, sortedGroups]);

  if (!canViewMemberDetail) {
    return <div style={emptyInlineStyle}>需要 member_detail 或 form_edit 权限才能查看和管理分组。</div>;
  }

  function handleDrop(groupId: number | null, e: DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const memberId = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isFinite(memberId)) return;
    const member = members.find((m) => m.id === memberId);
    if (!member || (member.group_id ?? null) === groupId) return;
    onAssignMemberGroup(memberId, groupId);
  }

  const columns: { key: number | "ungrouped"; id: number | null; title: string; score?: number; color?: string | null; leaderId?: number | null }[] = [
    { key: "ungrouped", id: null, title: "未分组" },
    ...sortedGroups.map((g) => ({ key: g.id, id: g.id, title: g.name, score: g.score ?? 0, color: g.color ?? null, leaderId: g.leader_member_id ?? null })),
  ];

  return (
    <div style={sectionBodyStyle}>
      {canEdit ? (
        <div style={{ ...memberToolbarStyle, justifyContent: "flex-start", gap: "8px" }}>
          <button type="button" style={primaryButtonStyle} onClick={() => onCreateGroup(nextGroupName(sortedGroups))}>
            + 新建小组
          </button>
          <button type="button" style={aiButtonStyle} onClick={async () => { const url = await onCreateScorePanel(); if (url) { setPanelUrl(`${PUBLIC_ORIGIN}${url}`); window.open(url, "_blank"); } }}>
            <i className="fa-solid fa-gamepad" style={{ marginRight: 6 }} />积分控制面板
          </button>
        </div>
      ) : null}

      {panelUrl ? (
        <div style={panelBarStyle}>
          <span style={mutedStyle}>控制面板链接（1 天内有效，可在手机打开控分）：</span>
          <div style={panelUrlBoxStyle}>{panelUrl}</div>
          <button type="button" style={btnStyle} onClick={() => void copyToClipboard(panelUrl)}>复制</button>
          <a href={panelUrl} target="_blank" rel="noreferrer" style={{ ...btnStyle, textDecoration: "none" }}>打开</a>
        </div>
      ) : null}

      <div style={mutedStyle}>
        {isMobile ? "点每张卡片下方的下拉，把成员移到小组。" : "把成员卡片拖到目标小组即可分组或移动（一人一组）。"}
        {" "}共 {members.length} 人 · {sortedGroups.length} 个小组。
      </div>

      <div style={groupBoardStyle(isMobile)}>
        {columns.map((col) => {
          const list = byGroup.get(col.id) || [];
          const active = dragOver === col.key;
          return (
            <section
              key={String(col.key)}
              style={{ ...groupColStyle, ...(active ? groupColHoverStyle : {}) }}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(col.key); } }}
              onDragLeave={() => setDragOver((cur) => (cur === col.key ? null : cur))}
              onDrop={(e) => handleDrop(col.id, e)}
            >
              <GroupColumnHeader
                groupId={col.id}
                title={col.title}
                count={list.length}
                color={col.color}
                canEdit={canEdit && col.id != null}
                onRename={onRenameGroup}
                onDelete={onDeleteGroup}
                onSetColor={(c) => { if (col.id != null) onSetGroupColor(col.id, c); }}
                onViewLog={() => { if (col.id != null) setLogGroup({ id: col.id as number, name: col.title }); }}
              />
              {col.id != null ? (
                <div style={scoreBarStyle}>
                  {canEdit ? (
                    <button type="button" style={scoreBtnStyle} title="扣 5 分" onClick={() => onAdjustGroupScore(col.id as number, -5)}>−5</button>
                  ) : null}
                  {canEdit ? (
                    <button type="button" style={scoreBtnStyle} title="扣 1 分" onClick={() => onAdjustGroupScore(col.id as number, -1)}>−1</button>
                  ) : null}
                  <span style={scoreValueStyle} title="小组积分">{col.score ?? 0}<span style={scoreUnitStyle}>分</span></span>
                  {canEdit ? (
                    <button type="button" style={scoreBtnStyle} title="加 1 分" onClick={() => onAdjustGroupScore(col.id as number, 1)}>＋1</button>
                  ) : null}
                  {canEdit ? (
                    <button type="button" style={scoreBtnStyle} title="加 5 分" onClick={() => onAdjustGroupScore(col.id as number, 5)}>＋5</button>
                  ) : null}
                </div>
              ) : null}
              <div style={groupColBodyStyle}>
                {!list.length ? (
                  <div style={groupEmptyStyle}>{col.id == null ? "全部已分组" : canEdit ? "拖成员到这里" : "暂无成员"}</div>
                ) : null}
                {list.map((m) => (
                  <MemberChipCard
                    key={m.id}
                    member={m}
                    canEdit={canEdit}
                    isMobile={isMobile}
                    currentGroupId={col.id}
                    groups={sortedGroups}
                    onMove={onAssignMemberGroup}
                    isLeader={col.id != null && col.leaderId === m.id}
                    onSetLeader={col.id != null ? () => onSetGroupLeader(col.id as number, col.leaderId === m.id ? null : m.id) : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {logGroup ? <GroupScoreLogModal groupId={logGroup.id} groupName={logGroup.name} onClose={() => setLogGroup(null)} /> : null}
    </div>
  );
}

const GROUP_PALETTE: Record<string, string> = {
  blue: "#dbeafe", green: "#dcfce7", yellow: "#fef9c3", pink: "#fce7f3", purple: "#ede9fe",
  orange: "#ffedd5", teal: "#ccfbf1", rose: "#ffe4e6", sky: "#e0f2fe", lime: "#ecfccb",
};

function GroupColumnHeader({
  groupId,
  title,
  count,
  color,
  canEdit,
  onRename,
  onDelete,
  onSetColor,
  onViewLog,
}: {
  groupId: number | null;
  title: string;
  count: number;
  color?: string | null;
  canEdit: boolean;
  onRename: (groupId: number, name: string) => void;
  onDelete: (groupId: number) => void;
  onSetColor: (color: string | null) => void;
  onViewLog: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [palette, setPalette] = useState(false);
  const tint = color && GROUP_PALETTE[color] ? GROUP_PALETTE[color] : undefined;
  const headStyle = tint ? { ...groupHeadStyle, background: tint } : groupHeadStyle;

  if (editing && groupId != null) {
    return (
      <div style={headStyle}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(groupId, draft); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
          style={{ ...factInputStyle, height: "30px" }}
        />
        <button type="button" style={factIconButtonStyle} title="保存" onClick={() => { onRename(groupId, draft); setEditing(false); }}><i className="fa-solid fa-check" /></button>
        <button type="button" style={factIconButtonStyle} title="取消" onClick={() => setEditing(false)}><i className="fa-solid fa-xmark" /></button>
      </div>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <div style={headStyle}>
        <div style={groupTitleStyle}>
          {tint ? <span style={{ width: 10, height: 10, borderRadius: 999, background: tint, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} /> : null}
          <span>{title}</span>
          <span style={groupCountStyle}>{count}</span>
        </div>
        {groupId != null ? (
          <div style={{ display: "inline-flex", gap: "4px" }}>
            <button type="button" style={factIconButtonStyle} title="积分记录" onClick={onViewLog}><i className="fa-solid fa-clock-rotate-left" /></button>
            {canEdit ? <button type="button" style={factIconButtonStyle} title="小组颜色" onClick={() => setPalette((v) => !v)}><i className="fa-solid fa-palette" /></button> : null}
            {canEdit ? <button type="button" style={factIconButtonStyle} title="重命名" onClick={() => { setDraft(title); setEditing(true); }}><i className="fa-solid fa-pen" /></button> : null}
            {canEdit ? <button type="button" style={factIconButtonStyle} title="删除小组" onClick={() => onDelete(groupId)}><i className="fa-solid fa-trash" /></button> : null}
          </div>
        ) : null}
      </div>
      {palette && canEdit ? (
        <div style={palettePopStyle}>
          {Object.entries(GROUP_PALETTE).map(([key, hex]) => (
            <button key={key} type="button" title={key} style={{ ...swatchStyle, background: hex, outline: color === key ? "2px solid var(--x-color-accent)" : "none" }} onClick={() => { onSetColor(key); setPalette(false); }} />
          ))}
          <button type="button" style={swatchClearStyle} title="清除" onClick={() => { onSetColor(null); setPalette(false); }}>✕</button>
        </div>
      ) : null}
    </div>
  );
}

function GroupScoreLogModal({ groupId, groupName, onClose }: { groupId: number; groupName: string; onClose: () => void }) {
  const [logs, setLogs] = useState<GroupScoreLogEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetchGroupScoreLog(groupId)
      .then((d) => { if (active) setLogs(d.logs || []); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "读取失败"); });
    return () => { active = false; };
  }, [groupId]);
  function fmt(v?: string | null) {
    if (!v) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, width: "min(440px, 100%)", maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
        <div style={publicHeadStyle}>
          <h4 style={panelTitleStyle}>{groupName} · 积分记录</h4>
          <button type="button" style={btnStyle} onClick={onClose}>关闭</button>
        </div>
        {error ? <div style={errorStyle}>{error}</div> : null}
        {logs && !logs.length ? <div style={emptyInlineStyle}>暂无积分记录。</div> : null}
        <div style={{ display: "grid", gap: 6, overflowY: "auto" }}>
          {(logs || []).map((l) => (
            <div key={l.id} style={logRowStyle}>
              <span style={{ ...logDeltaStyle, color: l.delta >= 0 ? "var(--x-color-success)" : "var(--x-color-danger)" }}>{l.delta >= 0 ? `+${l.delta}` : l.delta}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{l.actor_name || "—"}</span>
              <span style={mutedStyle}>{fmt(l.created_at)}</span>
            </div>
          ))}
          {!logs && !error ? <div style={emptyInlineStyle}>加载中…</div> : null}
        </div>
      </div>
    </div>
  );
}

function MemberChipCard({
  member,
  canEdit,
  isMobile,
  currentGroupId,
  groups,
  onMove,
  isLeader,
  onSetLeader,
}: {
  member: FormMember;
  canEdit: boolean;
  isMobile: boolean;
  currentGroupId: number | null;
  groups: FormGroup[];
  onMove: (memberId: number, groupId: number | null) => void;
  isLeader?: boolean;
  onSetLeader?: () => void;
}) {
  const age = calcAgeFromNric(member.nric);
  const gender = String(member.gender || "");
  const name = member.name_cn || member.name || `成员 #${member.id}`;
  const draggable = canEdit && !isMobile;
  return (
    <div
      style={{ ...memberCardStyle, cursor: draggable ? "grab" : "default", ...(isLeader ? memberLeaderCardStyle : {}) }}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(member.id));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div style={memberCardMainStyle}>
        <span style={memberCardNameStyle}>
          {isLeader ? <span style={leaderBadgeStyle} title="组长">👑 组长</span> : null}
          {name}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {onSetLeader ? (
            <button
              type="button"
              style={{ ...leaderStarStyle, ...(isLeader ? leaderStarActiveStyle : {}) }}
              title={isLeader ? "取消组长" : "设为组长"}
              onClick={(e) => { e.stopPropagation(); onSetLeader(); }}
            >
              {isLeader ? "★" : "☆"}
            </button>
          ) : null}
          <span style={memberCardMetaStyle}>{age != null ? `${age}岁` : "—"}{gender ? ` · ${gender}` : ""}</span>
        </span>
      </div>
      {canEdit && isMobile ? (
        <select
          value={currentGroupId == null ? "" : String(currentGroupId)}
          onChange={(e) => onMove(member.id, e.target.value === "" ? null : Number(e.target.value))}
          style={memberCardSelectStyle}
        >
          <option value="">未分组</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function SettingsTab({
  form,
  isMobile,
  canEdit,
  onPatchForm,
}: {
  form: FormRecord;
  isMobile: boolean;
  canEdit: boolean;
  onPatchForm: (patch: Partial<FormRecord>) => void;
}) {
  const setSwitch = (patch: Partial<FormRecord["field_switches"]>) =>
    onPatchForm({ field_switches: { ...(form.field_switches || {}), ...patch } });
  const sw = (key: keyof NonNullable<FormRecord["field_switches"]>, fallback: unknown) =>
    Boolean(form.field_switches?.[key] ?? fallback);

  return (
    <div style={sectionBodyStyle}>
      <div style={detailGridStyle(isMobile)}>
        <EditableFact label="标题" value={form.title} editable={canEdit} onSave={(v) => onPatchForm({ title: v })} />
        <EditableFact label="截止日期" value={form.expired || ""} kind="date" editable={canEdit} onSave={(v) => onPatchForm({ expired: v })} />
        <EditableFact
          label="最大报名人数（留空=不限）"
          value={form.max_members != null ? String(form.max_members) : ""}
          kind="number"
          editable={canEdit}
          onSave={(v) => {
            const trimmed = v.trim();
            const num = trimmed === "" ? null : Number(trimmed);
            onPatchForm({ max_members: num != null && Number.isFinite(num) && num > 0 ? Math.floor(num) : null });
          }}
        />
      </div>
      <EditableFact label="详情" value={form.detail || ""} kind="textarea" editable={canEdit} onSave={(v) => onPatchForm({ detail: v })} />
      <EditableFact label="注意事项（成员终端信息页显示）" value={form.notes || ""} kind="textarea" editable={canEdit} onSave={(v) => onPatchForm({ notes: v })} />

      <div style={sectionTitleStyle}>报名状态</div>
      <RegistrationStatusControl form={form} canEdit={canEdit} onPatchForm={onPatchForm} />

      <div style={sectionTitleStyle}>字段开关</div>
      <div style={toggleGridStyle}>
        <ConfigToggle label="启用 Email" checked={sw("email", form.email)} disabled={!canEdit} onChange={(n) => setSwitch({ email: n })} />
        <ConfigToggle label="家长同意书" checked={sw("parental_form", form.parental_form)} disabled={!canEdit} onChange={(n) => setSwitch({ parental_form: n })} />
        <ConfigToggle label="家长 1" checked={sw("parent_1", form.parent_1)} disabled={!canEdit} onChange={(n) => setSwitch({ parent_1: n, parent_1_phone: n })} />
        <ConfigToggle label="家长 2" checked={sw("parent_2", form.parent_2)} disabled={!canEdit} onChange={(n) => setSwitch({ parent_2: n, parent_2_phone: n })} />
        <ConfigToggle label="居住地址" checked={sw("address", form.address)} disabled={!canEdit} onChange={(n) => setSwitch({ address: n })} />
        <ConfigToggle label="医疗备注" checked={sw("medical", form.medical)} disabled={!canEdit} onChange={(n) => setSwitch({ medical: n })} />
        <ConfigToggle label="过敏" checked={sw("allergy", form.allergy)} disabled={!canEdit} onChange={(n) => setSwitch({ allergy: n })} />
        <ConfigToggle label="其他备注" checked={sw("other_remark", form.other_remark)} disabled={!canEdit} onChange={(n) => setSwitch({ other_remark: n })} />
        <ConfigToggle label="弹性参加时段" checked={sw("flexible_time_slot", form.flexible_time_slot)} disabled={!canEdit} onChange={(n) => setSwitch({ flexible_time_slot: n })} />
      </div>
      <div style={mutedStyle}>已启用 {getEnabledFieldSwitchCount(form)} 个默认字段。</div>
    </div>
  );
}

function RegistrationStatusControl({
  form,
  canEdit,
  onPatchForm,
}: {
  form: FormRecord;
  canEdit: boolean;
  onPatchForm: (patch: Partial<FormRecord>) => void;
}) {
  const count = form.member_count ?? (form.members || []).length;
  const max = form.max_members ?? null;
  const closedManually = Boolean(form.closed_manually);
  const isFull = form.is_full ?? (max != null && count >= max);
  const isExpired = form.expired
    ? new Date(`${form.expired}T23:59:59`) < new Date()
    : false;

  let label = "报名进行中";
  let tone: CSSProperties = { background: "var(--x-color-success-soft)", color: "var(--x-color-success)", borderColor: "rgba(21,128,61,0.28)" };
  if (closedManually) {
    label = "已手动终止";
    tone = { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", borderColor: "var(--x-color-danger-border)" };
  } else if (isExpired) {
    label = "已过截止日期";
    tone = { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)", borderColor: "var(--x-color-line)" };
  } else if (isFull) {
    label = "名额已满";
    tone = { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)", borderColor: "var(--x-color-warning-border)" };
  }

  return (
    <div style={{ display: "grid", gap: "10px", padding: "12px 14px", borderRadius: "8px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ padding: "3px 12px", borderRadius: "999px", border: "1px solid", fontSize: "13px", fontWeight: 700, ...tone }}>{label}</span>
        <span style={mutedStyle}>
          已报名 {count} {max != null ? `/ ${max}` : ""} 人{max == null ? "（不限人数）" : ""}
        </span>
      </div>
      {canEdit ? (
        closedManually ? (
          <button type="button" style={btnStyle} onClick={() => onPatchForm({ closed_manually: false })}>
            重新开放报名
          </button>
        ) : (
          <button type="button" style={dangerButtonStyle} onClick={() => onPatchForm({ closed_manually: true })}>
            终止报名
          </button>
        )
      ) : null}
      {closedManually ? <div style={mutedStyle}>报名已手动终止，公开报名页将显示「报名已截止」。可随时重新开放。</div> : null}
    </div>
  );
}

function PublicTab({ formId, isMobile }: { formId: number; isMobile: boolean }) {
  const registerUrl = `${PUBLIC_ORIGIN}/api/form/index/${formId}`;
  const forceRegisterUrl = `${registerUrl}?force=true`;
  const payUrl = `${PUBLIC_ORIGIN}/api/form/pay_register/${formId}`;
  const memberUrl = `${PUBLIC_ORIGIN}/api/form/member?form_id=${formId}`;
  const [copied, setCopied] = useState("");
  async function copy(url: string, label: string) {
    const ok = await copyToClipboard(url);
    setCopied(ok ? `${label}链接已复制` : "复制失败，请手动复制");
    window.setTimeout(() => setCopied(""), 2200);
  }
  const [previewUrl, setPreviewUrl] = useState(registerUrl);
  const [qrModal, setQrModal] = useState<{ label: string; url: string; data: string } | null>(null);
  async function openQr(url: string, label: string) {
    try {
      const data = await QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
      setQrModal({ label, url, data });
    } catch {
      setCopied("二维码生成失败");
      window.setTimeout(() => setCopied(""), 2200);
    }
  }
  function downloadQr() {
    if (!qrModal) return;
    const a = document.createElement("a");
    a.href = qrModal.data;
    a.download = `qr_${qrModal.label}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  const entries: { label: string; url: string; note?: string }[] = [
    { label: "报名页", url: registerUrl },
    { label: "强制报名链接", url: forceRegisterUrl, note: "绕过截止日期、名额已满与手动终止，仅在需要补录时私下发送。" },
    { label: "付款页", url: payUrl },
    { label: "成员终端（公共入口）", url: memberUrl, note: "报名者凭 NRIC 进入，查看自己的报名资料与活动流程。仅在活动结束时间之前开放。" },
  ];
  return (
    <div style={sectionBodyStyle}>
      {copied ? <div style={successStyle}>{copied}</div> : null}
      <div style={publicSplitStyle(isMobile)}>
        <div style={publicLinksStyle}>
          {entries.map((e) => {
            const active = previewUrl === e.url;
            return (
              <div key={e.label} style={linkCardStyle(active)}>
                <div style={publicHeadStyle}>
                  <span style={sectionTitleStyle}>{e.label}</span>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button type="button" style={active ? primaryButtonStyle : btnStyle} onClick={() => setPreviewUrl(e.url)}>预览</button>
                    <button type="button" style={btnStyle} onClick={() => void copy(e.url, e.label)}>复制链接</button>
                    <button type="button" style={btnStyle} onClick={() => void openQr(e.url, e.label)}>QR code</button>
                  </div>
                </div>
                <div style={urlBoxStyle}>{e.url}</div>
                {e.note ? <div style={mutedStyle}>{e.note}</div> : null}
              </div>
            );
          })}
        </div>
        <div style={publicPreviewStyle(isMobile)}>
          <PhoneFrame src={previewUrl} title="预览" />
        </div>
      </div>
      {qrModal ? (
        <div style={qrOverlayStyle} onClick={() => setQrModal(null)}>
          <div style={qrCardStyle} onClick={(ev) => ev.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1f2937" }}>{qrModal.label} · 二维码</div>
            <img src={qrModal.data} alt="二维码" style={{ width: "min(300px, 70vw)", height: "auto", borderRadius: 12, border: "1px solid #e5e7eb" }} />
            <div style={{ ...urlBoxStyle, wordBreak: "break-all" }}>{qrModal.url}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={primaryButtonStyle} onClick={downloadQr}>下载 QR</button>
              <button type="button" style={btnStyle} onClick={() => setQrModal(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const qrOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,0.6)", display: "grid", placeItems: "center", padding: 20 };
const qrCardStyle: CSSProperties = { width: "min(360px, 100%)", background: "#fff", borderRadius: 18, padding: 20, textAlign: "center", boxShadow: "0 30px 70px rgba(0,0,0,0.4)", display: "grid", gap: 12, justifyItems: "center" };

function PhoneFrame({ src, title }: { src: string; title: string }) {
  return (
    <div style={phoneShellStyle}>
      <div style={phoneNotchStyle} />
      <div style={phoneScreenWrapStyle}>
        <iframe src={src} title={title} style={phoneScreenStyle} />
      </div>
      <div style={phoneHomeBarStyle} />
    </div>
  );
}

function EditableFact({
  label,
  value,
  editable,
  onSave,
  kind = "text",
}: {
  label: string;
  value: string;
  editable: boolean;
  onSave: (value: string) => void;
  kind?: "text" | "date" | "textarea" | "number";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  function begin() {
    setDraft(value ?? "");
    setEditing(true);
  }
  function commit() {
    onSave(kind === "date" ? draft.trim() : draft);
    setEditing(false);
  }
  const display = value && value.trim() ? value : "未填写";
  return (
    <div style={{ ...factStyle, ...(kind === "textarea" ? { gridColumn: "1 / -1" } : {}) }}>
      <div style={factHeadStyle}>
        <div style={factLabelStyle}>{label}</div>
        {editable ? (
          editing ? (
            <div style={factIconGroupStyle}>
              <button type="button" style={factIconButtonStyle} title="保存" onClick={commit}><i className="fa-solid fa-floppy-disk" /></button>
              <button type="button" style={factIconButtonStyle} title="取消" onClick={() => setEditing(false)}><i className="fa-solid fa-xmark" /></button>
            </div>
          ) : (
            <button type="button" style={factIconButtonStyle} title="编辑" onClick={begin}><i className="fa-solid fa-pen" /></button>
          )
        ) : null}
      </div>
      {editing ? (
        kind === "textarea" ? (
          <textarea style={{ ...factInputStyle, minHeight: "180px", resize: "vertical" }} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <input type={kind === "date" ? "date" : kind === "number" ? "number" : "text"} min={kind === "number" ? 0 : undefined} style={factInputStyle} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
        )
      ) : (
        <div style={{ ...factValueStyle, ...(kind === "textarea" ? { whiteSpace: "pre-wrap" } : {}) }}>{display}</div>
      )}
    </div>
  );
}

function ConfigToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label style={configToggleStyle(checked)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ExtraFieldPanel({ fields, readOnly, onAdd, onEdit, onDelete }: {
  fields: ExtraFieldConfig[];
  readOnly?: boolean;
  onAdd: (payload: ExtraFieldDraft) => void;
  onEdit: (fieldId: number, payload: ExtraFieldDraft) => void;
  onDelete: (fieldId: number) => void;
}) {
  return (
    <div style={sectionBodyStyle}>
      {!readOnly ? <ExtraFieldEditor buttonLabel="添加字段" onSave={(payload) => onAdd(normalizeExtraFieldDraft(payload, fields.length))} /> : null}
      <div style={stackStyle}>
        {fields.length ? (
          fields.map((field) => (
            <ExtraFieldEditor
              key={field.id}
              initialValue={{ label: field.label, field_type: field.field_type, options: field.options || null, order: field.order ?? null }}
              buttonLabel="保存"
              readOnly={readOnly}
              onSave={(payload) => onEdit(field.id, normalizeExtraFieldDraft(payload, field.order ?? 0))}
              onDelete={() => onDelete(field.id)}
            />
          ))
        ) : (
          <div style={emptyInlineStyle}>暂无表格内容。</div>
        )}
      </div>
    </div>
  );
}

function LinkedEventHeadChip({ event, canEditForms, onOpen, onRemove }: {
  event: FormEvent;
  canEditForms: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    let active = true;
    const imageId = event.event_image?.id;
    if (!imageId) { setImageUrl(""); return () => { active = false; }; }
    void smartImageURL(imageId, "cache")
      .then((url) => { if (active) setImageUrl(url && !url.includes("broken-image.png") ? url : ""); })
      .catch(() => { if (active) setImageUrl(""); });
    return () => { active = false; };
  }, [event.event_image?.id]);

  return (
    <span style={headChipStyle}>
      <button type="button" style={headChipMainStyle} onClick={onOpen} title="进入活动详情">
        {imageUrl ? (
          <CachedImage src={imageUrl} cacheKey={`form-linked-event:${event.id}:${event.event_image?.id || "poster"}`} alt={event.event_name || `活动 #${event.id}`} style={headPosterStyle} />
        ) : (
          <span style={headPosterPlaceholderStyle}><i className="fa-solid fa-image" aria-hidden="true" /></span>
        )}
        <span style={headChipNameStyle}>{event.event_name || `活动 #${event.id}`}</span>
      </button>
      {canEditForms ? <button type="button" style={headChipRemoveStyle} onClick={onRemove} title="移除关联">×</button> : null}
    </span>
  );
}

function CreateFormModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (payload: FormCreatePayload) => void }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [expired, setExpired] = useState("");
  const [extras, setExtras] = useState<ExtraFieldDraft[]>([]);
  const [flags, setFlags] = useState({ email: true, parental_form: false, parent_1: true, parent_2: false, address: false, medical: false, allergy: false, other_remark: false, flexible_time_slot: false });

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={publicHeadStyle}>
          <h4 style={panelTitleStyle}>新建报名表</h4>
          <button type="button" style={btnStyle} onClick={onClose}>关闭</button>
        </div>
        <div style={createGridStyle}>
          <label style={fieldStyle}><span style={factLabelStyle}>标题</span><input style={factInputStyle} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label style={fieldStyle}><span style={factLabelStyle}>截止日期</span><input type="date" style={factInputStyle} value={expired} onChange={(e) => setExpired(e.target.value)} /></label>
          <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}><span style={factLabelStyle}>详情</span><textarea style={{ ...factInputStyle, minHeight: "120px", resize: "vertical" }} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
        </div>
        <div style={sectionTitleStyle}>配置开关</div>
        <div style={toggleGridStyle}>
          {Object.entries({ email: "启用 Email", parental_form: "家长同意书", parent_1: "家长 1", parent_2: "家长 2", address: "居住地址", medical: "医疗备注", allergy: "过敏", other_remark: "其他备注", flexible_time_slot: "弹性参加时段" }).map(([key, label]) => (
            <ConfigToggle key={key} label={label} checked={Boolean(flags[key as keyof typeof flags])} onChange={(next) => setFlags((prev) => ({ ...prev, [key]: next }))} />
          ))}
        </div>
        <div style={sectionTitleStyle}>表格内容</div>
        <div style={stackStyle}>
          {extras.map((item, index) => (
            <ExtraFieldEditor
              key={index}
              initialValue={item}
              buttonLabel="更新字段"
              onSave={(payload) => setExtras((prev) => prev.map((entry, i) => (i === index ? normalizeExtraFieldDraft(payload, i) : entry)))}
              onDelete={() => setExtras((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
          <button type="button" style={btnStyle} onClick={() => setExtras((prev) => [...prev, { label: "", field_type: "text", options: null, order: prev.length }])}>添加表格内容</button>
        </div>
        <div style={modalFooterStyle}>
          <button type="button" style={btnStyle} onClick={onClose}>取消</button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() =>
              onSubmit({
                title, detail, expired, ...flags,
                field_switches: { ...flags, parent_1_phone: flags.parent_1, parent_2_phone: flags.parent_2 },
                parent_1_phone: flags.parent_1, parent_2_phone: flags.parent_2,
                extra_fields_config: extras.filter((item) => item.label.trim()).map((item, index) => normalizeExtraFieldDraft(item, index)),
              })
            }
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

const TABLE_CSS = `
.fw-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 760px; }
.fw-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 9px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--x-color-ink-muted); background: var(--x-color-canvas-alt);
  border-bottom: 1px solid var(--x-color-line); white-space: nowrap;
}
.fw-table tbody td { padding: 10px 12px; border-bottom: 1px solid var(--x-color-line-soft); vertical-align: middle; color: var(--x-color-ink); }
.fw-table tbody tr.fw-row { cursor: pointer; }
.fw-table tbody tr.fw-row:hover td { background: var(--x-color-accent-tint); }
.fw-btn { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--x-color-line); background: var(--x-color-panel); color: var(--x-color-ink); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.fw-btn:hover:not(:disabled) { border-color: var(--x-color-accent-border); background: var(--x-color-accent-soft); }
.fw-btn--danger { border-color: var(--x-color-danger-border); background: var(--x-color-danger-soft); color: var(--x-color-danger); }
`;

const pageStyle: CSSProperties = { display: "grid", gap: "16px" };
const panelStyle: CSSProperties = { borderRadius: "12px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", boxShadow: "0 1px 2px var(--x-color-shadow-soft)", overflow: "hidden" };

function toolbarStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: "10px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row", padding: "12px 16px", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)" };
}
function headerStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: "10px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row", padding: "12px 16px", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)" };
}
const headerLeftStyle: CSSProperties = { display: "flex", gap: "12px", alignItems: "flex-start" };
function headerRightStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", width: isMobile ? "100%" : undefined };
}

const eyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const panelTitleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

const tabBarWrapStyle: CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--x-color-line-soft)", overflowX: "auto" };
const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const tabStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px", borderRadius: "8px", border: "1px solid transparent", background: "transparent", color: "var(--x-color-ink-muted)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const tabActiveStyle: CSSProperties = { ...tabStyle, border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", boxShadow: "0 1px 2px var(--x-color-shadow-soft)" };

const btnStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const primaryButtonStyle: CSSProperties = { padding: "9px 18px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer" };
const dangerButtonStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };

const errorStyle: CSSProperties = { margin: "12px 14px 0", padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
const successStyle: CSSProperties = { margin: "12px 14px 0", padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-success-soft)", border: "1px solid rgba(21,128,61,0.28)", color: "var(--x-color-success)", fontSize: "13px" };
const emptyStyle: CSSProperties = { margin: "16px", padding: "28px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const emptyInlineStyle: CSSProperties = { padding: "12px 14px", borderRadius: "8px", border: "1px dashed var(--x-color-line)", color: "var(--x-color-ink-muted)", fontSize: "13px" };

const bodyStyle: CSSProperties = { padding: "16px 18px", display: "grid", gap: "14px" };
const sectionBodyStyle: CSSProperties = { display: "grid", gap: "10px" };
const sectionTitleStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const stackStyle: CSSProperties = { display: "grid", gap: "8px" };

const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto" };
const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };
const cellSubStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginTop: "2px" };
const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };
const actionsCellStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };

const memberToolbarStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" };
const searchInputStyle: CSSProperties = { flex: "1 1 220px", minHeight: "34px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };

// -------- 分组（拖拽看板）--------
function groupBoardStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridAutoFlow: isMobile ? "row" : "column",
    gridAutoColumns: isMobile ? undefined : "minmax(200px, 1fr)",
    gridTemplateColumns: isMobile ? "1fr" : undefined,
    gap: "10px",
    overflowX: isMobile ? undefined : "auto",
    paddingBottom: "4px",
    alignItems: "start",
  };
}
const groupColStyle: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0, borderRadius: "10px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", minHeight: "120px" };
const groupColHoverStyle: CSSProperties = { border: "1px dashed var(--x-color-accent)", background: "var(--x-color-accent-tint)" };
const groupHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "8px 10px", borderBottom: "1px solid var(--x-color-line-soft)" };
const groupTitleStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "13px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const groupCountStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "20px", height: "18px", padding: "0 6px", borderRadius: "999px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", fontSize: "11px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const panelBarStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 12px", borderRadius: "9px", background: "var(--x-color-accent-tint)", border: "1px solid var(--x-color-accent-border)" };
const panelUrlBoxStyle: CSSProperties = { flex: "1 1 220px", minWidth: 0, padding: "7px 10px", borderRadius: "7px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", fontFamily: "var(--x-font-mono)", fontSize: "12px", wordBreak: "break-all" };
const palettePopStyle: CSSProperties = { position: "absolute", right: 6, top: "100%", zIndex: 20, display: "grid", gridTemplateColumns: "repeat(5, 22px)", gap: 6, padding: 8, borderRadius: 10, background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", boxShadow: "0 12px 30px var(--x-color-shadow)" };
const swatchStyle: CSSProperties = { width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(0,0,0,0.12)", cursor: "pointer" };
const swatchClearStyle: CSSProperties = { width: 22, height: 22, borderRadius: 6, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)", cursor: "pointer", fontSize: 11 };
const logRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)", fontSize: 13 };
const logDeltaStyle: CSSProperties = { minWidth: 44, fontWeight: 800, fontFamily: "var(--x-font-mono)" };
const scoreBarStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "6px 8px", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", flexWrap: "wrap" };
const scoreBtnStyle: CSSProperties = { minWidth: "30px", padding: "4px 7px", borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontWeight: 800, fontSize: "13px", cursor: "pointer", lineHeight: 1 };
const scoreValueStyle: CSSProperties = { minWidth: "44px", textAlign: "center", fontWeight: 800, fontSize: "18px", color: "var(--x-color-accent-strong)" };
const scoreUnitStyle: CSSProperties = { fontSize: "11px", fontWeight: 700, color: "var(--x-color-ink-muted)", marginLeft: "2px" };
const groupColBodyStyle: CSSProperties = { display: "grid", gap: "6px", padding: "8px", alignContent: "start" };
const groupEmptyStyle: CSSProperties = { padding: "14px 8px", borderRadius: "8px", border: "1px dashed var(--x-color-line)", textAlign: "center", fontSize: "12px", color: "var(--x-color-ink-muted)" };
const memberCardStyle: CSSProperties = { display: "grid", gap: "6px", padding: "8px 10px", borderRadius: "8px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", boxShadow: "0 1px 2px var(--x-color-shadow-soft)" };
const memberLeaderCardStyle: CSSProperties = { border: "1px solid var(--x-color-accent-border)", boxShadow: "inset 0 0 0 1px var(--x-color-accent-tint)" };
const leaderBadgeStyle: CSSProperties = { display: "inline-block", marginRight: 6, padding: "1px 6px", borderRadius: 999, background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", fontSize: 10.5, fontWeight: 800, verticalAlign: "middle" };
const leaderStarStyle: CSSProperties = { border: "none", background: "transparent", color: "var(--x-color-ink-muted)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 };
const leaderStarActiveStyle: CSSProperties = { color: "#f59e0b" };
const memberCardMainStyle: CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", minWidth: 0 };
const memberCardNameStyle: CSSProperties = { fontWeight: 700, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const memberCardMetaStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", whiteSpace: "nowrap", flexShrink: 0 };
const memberCardSelectStyle: CSSProperties = { width: "100%", padding: "5px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "12px" };

// -------- AI 分组对话 --------
const aiButtonStyle: CSSProperties = { padding: "9px 16px", borderRadius: "8px", border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const chatPaneStyle: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" };
const chatListStyle: CSSProperties = { flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", background: "var(--x-color-canvas-alt)" };
const planLineStyle: CSSProperties = { fontSize: "12.5px", color: "var(--x-color-ink)", marginTop: "2px" };
function memberPanelStyle(isMobile: boolean): CSSProperties {
  return isMobile
    ? { display: "flex", flexDirection: "column", maxHeight: "30vh", borderBottom: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)" }
    : { display: "flex", flexDirection: "column", width: "270px", flexShrink: 0, borderLeft: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)" };
}
const memberPanelHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "10px 12px", borderBottom: "1px solid var(--x-color-line-soft)" };
const memberPanelListStyle: CSSProperties = { flex: 1, overflowY: "auto", padding: "8px", display: "grid", gap: "5px", alignContent: "start" };
const memberInfoRowStyle: CSSProperties = { display: "grid", gap: "1px", textAlign: "left", padding: "6px 9px", borderRadius: "7px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", cursor: "pointer", width: "100%" };
const memberInfoMetaStyle: CSSProperties = { fontSize: "11.5px", color: "var(--x-color-ink-muted)" };
const chatEmptyStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", margin: "auto 0" };
const chatExampleStyle: CSSProperties = { textAlign: "left", padding: "8px 12px", borderRadius: "8px", border: "1px dashed var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", fontSize: "13px", cursor: "pointer", width: "100%" };
const chatRowUserStyle: CSSProperties = { display: "flex", justifyContent: "flex-end" };
const chatRowAiStyle: CSSProperties = { display: "flex", justifyContent: "flex-start" };
const chatBubbleUserStyle: CSSProperties = { maxWidth: "82%", padding: "9px 12px", borderRadius: "12px 12px 2px 12px", background: "var(--x-color-accent)", color: "#fff", fontSize: "13.5px", lineHeight: 1.5 };
const chatBubbleAiStyle: CSSProperties = { maxWidth: "82%", padding: "9px 12px", borderRadius: "12px 12px 12px 2px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", color: "var(--x-color-ink)", fontSize: "13.5px", lineHeight: 1.5 };
const planBoxStyle: CSSProperties = { marginTop: "8px", padding: "10px", borderRadius: "8px", background: "var(--x-color-accent-tint)", border: "1px solid var(--x-color-accent-border)" };
const chatInputBarStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "flex-end", padding: "12px 16px", borderTop: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const chatTextareaStyle: CSSProperties = { flex: 1, resize: "none", padding: "9px 11px", borderRadius: "10px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "13.5px", lineHeight: 1.5, boxSizing: "border-box" };

function detailGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "8px" };
}
const factStyle: CSSProperties = { padding: "10px 12px", borderRadius: "8px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", display: "grid", gap: "3px" };
const factHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" };
const factLabelStyle: CSSProperties = { fontSize: "10.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const factValueStyle: CSSProperties = { fontSize: "13px", lineHeight: 1.5, wordBreak: "break-word", fontWeight: 600 };
const factIconGroupStyle: CSSProperties = { display: "inline-flex", gap: "4px" };
const factIconButtonStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", borderRadius: "6px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink-muted)", cursor: "pointer", fontSize: "11px", flexShrink: 0 };
const factInputStyle: CSSProperties = { width: "100%", padding: "7px 9px", borderRadius: "7px", border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", fontWeight: 600, boxSizing: "border-box" };

const fieldStyle: CSSProperties = { display: "grid", gap: "4px" };
const toggleGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px" };
const configToggleStyle = (checked: boolean): CSSProperties => ({ display: "flex", gap: "6px", alignItems: "center", padding: "8px 10px", borderRadius: "8px", border: checked ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", background: checked ? "var(--x-color-accent-tint)" : "var(--x-color-panel-alt)", color: "var(--x-color-ink)", fontSize: "13px", fontWeight: 600 });

const linkedHeadRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "5px" };
const linkedAddBtnStyle: CSSProperties = { padding: "3px 9px", borderRadius: "999px", border: "1px dashed var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", fontSize: "11.5px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const headChipStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "1px", padding: "2px 2px 2px 3px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-alt)" };
const headChipMainStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 3px 0 0", border: "none", background: "transparent", color: "var(--x-color-ink)", cursor: "pointer", maxWidth: "160px" };
const headPosterStyle: CSSProperties = { width: 20, height: 27, objectFit: "cover", borderRadius: "5px", border: "1px solid var(--x-color-line-soft)", display: "block", flexShrink: 0 };
const headPosterPlaceholderStyle: CSSProperties = { width: 20, height: 27, display: "grid", placeItems: "center", borderRadius: "5px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", fontSize: "10px", flexShrink: 0 };
const headChipNameStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const headChipRemoveStyle: CSSProperties = { flexShrink: 0, width: 18, height: 18, borderRadius: "999px", border: "none", background: "transparent", color: "var(--x-color-ink-muted)", fontSize: "14px", lineHeight: 1, cursor: "pointer" };

const urlBoxStyle: CSSProperties = { padding: "10px 12px", borderRadius: "8px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", fontFamily: "var(--x-font-mono)", fontSize: "12.5px", wordBreak: "break-all" };
function publicGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "14px" };
}
function publicSplitStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", flexDirection: isMobile ? "column" : "row", gap: "16px", alignItems: "flex-start" };
}
const publicLinksStyle: CSSProperties = { flex: 1, minWidth: 0, display: "grid", gap: "10px", alignContent: "start" };
function publicPreviewStyle(isMobile: boolean): CSSProperties {
  return { width: isMobile ? "100%" : "min(380px, 42vw)", flexShrink: 0, position: isMobile ? "static" : "sticky", top: "8px", alignSelf: isMobile ? "stretch" : "flex-start" };
}
function linkCardStyle(active: boolean): CSSProperties {
  return { display: "grid", gap: "6px", padding: "12px", borderRadius: "10px", background: "var(--x-color-panel-alt)", border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", boxShadow: active ? "0 0 0 2px var(--x-color-accent-tint)" : "none" };
}
const publicHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" };

const phoneShellStyle: CSSProperties = { position: "relative", width: "min(360px, 100%)", margin: "0 auto", background: "linear-gradient(160deg, #1b2432, #0b1220)", borderRadius: "46px", padding: "14px", boxShadow: "0 30px 60px rgba(15,23,42,0.35), inset 0 0 0 2px rgba(255,255,255,0.06)", boxSizing: "border-box" };
const phoneNotchStyle: CSSProperties = { position: "absolute", top: "22px", left: "50%", transform: "translateX(-50%)", width: "120px", height: "24px", borderRadius: "999px", background: "#05070c", zIndex: 2 };
const phoneScreenWrapStyle: CSSProperties = { borderRadius: "34px", overflow: "hidden", background: "#fff", border: "1px solid rgba(0,0,0,0.35)" };
const phoneScreenStyle: CSSProperties = { display: "block", width: "100%", height: "min(70vh, 680px)", border: "none", background: "#fff" };
const phoneHomeBarStyle: CSSProperties = { width: "110px", height: "5px", borderRadius: "999px", background: "rgba(255,255,255,0.5)", margin: "10px auto 2px" };

const modalOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", background: "rgba(15, 23, 42, 0.55)" };
const modalStyle: CSSProperties = { width: "min(880px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "18px", borderRadius: "14px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", boxShadow: "0 24px 60px var(--x-color-shadow)", display: "grid", gap: "12px" };
const createGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" };
const modalFooterStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" };

function chipStyle(tone: "success" | "danger" | "warning" | "muted"): CSSProperties {
  const palette =
    tone === "success" ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
    : tone === "danger" ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
    : tone === "warning" ? { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" }
    : { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" };
  return { display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap", ...palette };
}
