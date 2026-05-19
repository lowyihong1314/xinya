import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import QRCode from "qrcode";

import { CachedImage } from "../../../components/CachedMedia";
import { downloadUrl } from "../../../js/browserActions";
import { smartImageURL } from "../../../js/get_img";
import { ExtraFieldEditor } from "./ExtraFieldEditor";
import { FeePanel } from "./FeePanel";
import type { ExtraFieldDraft } from "./ExtraFieldEditor";
import type { ExtraFieldConfig, FormCreatePayload, FormEvent, FormFee, FormMember, FormRecord } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;
const MEMBER_PAGE_SIZE = 8;

type FeePayload = {
  category: string;
  amount: string;
  age_range_from?: string;
  age_range_to?: string;
  description?: string;
  image_path?: string | null;
};

type WorkspaceKey = "settings" | "events" | "fees" | "fields" | "members";

const WORKSPACE_ITEMS: Array<{
  key: WorkspaceKey;
  title: string;
  eyebrow: string;
  description: string;
  icon: string;
}> = [
  {
    key: "settings",
    title: "基本设置",
    eyebrow: "Summary",
    description: "标题、截止日期、详情与字段开关",
    icon: "fa-solid fa-sliders",
  },
  {
    key: "events",
    title: "关联活动",
    eyebrow: "Event",
    description: "绑定或移除活动来源",
    icon: "fa-solid fa-calendar-check",
  },
  {
    key: "fees",
    title: "报名费",
    eyebrow: "Fees",
    description: "配置收费类别、金额与付款资料",
    icon: "fa-solid fa-receipt",
  },
  {
    key: "fields",
    title: "表格内容",
    eyebrow: "Extra Fields",
    description: "管理报名表额外填写项目",
    icon: "fa-solid fa-list-check",
  },
  {
    key: "members",
    title: "报名成员",
    eyebrow: "Members",
    description: "查看成员、付款状态与导出 Excel",
    icon: "fa-solid fa-users",
  },
];
type WorkspaceItem = (typeof WORKSPACE_ITEMS)[number];

function normalizeExtraFieldDraft(draft: ExtraFieldDraft, index: number): ExtraFieldDraft {
  const label = draft.label.trim();
  const normalizedLabel = label.replace(/\s+/g, " ");

  return {
    ...draft,
    label: normalizedLabel,
    order: draft.order ?? index,
  };
}

function sanitizeFilenamePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "form";
}

async function exportMembersToExcel(formTitle: string, members: FormMember[], extraFields: ExtraFieldConfig[]) {
  const XLSX = await import("xlsx");
  const rows = members.map((member) => {
    const values = member.extra_fields || member.field_values || [];
    const row: Record<string, unknown> = {
      ID: member.id,
      中文名: member.name_cn || "",
      英文名: member.name || "",
      NRIC: member.nric || "",
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
  XLSX.writeFile(workbook, `${sanitizeFilenamePart(formTitle)}_members.xlsx`);
}

function hasCheckedPayment(member: FormMember) {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  return payments.some((payment) => payment.status === "checked");
}

function hasPendingPayment(member: FormMember) {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  return payments.some((payment) => payment.status !== "checked" && payment.status !== "fail");
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

export function FormWorkspaceView(props: {
  isMobile?: boolean;
  canReadForms: boolean;
  canEditForms: boolean;
  canViewMemberDetail: boolean;
  canEditMembers: boolean;
  forms: FormRecord[];
  selectedForm: FormRecord | null;
  fees: FormFee[];
  extraFields: ExtraFieldConfig[];
  loading: boolean;
  detailLoading: boolean;
  createOpen: boolean;
  toast: Toast;
  realtimeEnabled: boolean;
  onOpenForm: (formId: number) => void;
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
  onShowMemberDetail: (member: FormMember) => void;
  onOpenParental: (member: FormMember) => void;
  onRefresh: () => void;
  onToggleRealtime: (nextValue: boolean) => void;
}) {
  const isMobile = props.isMobile ?? false;
  const selectedForm = props.selectedForm;
  const linkedEvents = selectedForm?.events || [];
  const [shareView, setShareView] = useState<null | "share" | "share_payment">(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const activeWorkspaceItem = activeWorkspace ? WORKSPACE_ITEMS.find((item) => item.key === activeWorkspace) ?? null : null;
  const selectedMembers = selectedForm?.members || [];
  const parentalFormEnabled = Boolean(selectedForm?.field_switches?.parental_form ?? selectedForm?.parental_form);
  const memberCount = selectedForm?.member_count ?? selectedMembers.length;
  const paidMemberCount = selectedMembers.filter(hasCheckedPayment).length;
  const pendingPaymentCount = selectedMembers.filter(hasPendingPayment).length;
  const enabledFieldSwitchCount = selectedForm ? getEnabledFieldSwitchCount(selectedForm) : 0;

  useEffect(() => {
    setActiveWorkspace(null);
    setShareView(null);
    setIframeUrl(null);
    if (!selectedForm?.id) {
      setMobileDetailOpen(false);
    }
  }, [selectedForm?.id]);

  function handleOpenForm(formId: number) {
    setMobileDetailOpen(true);
    props.onOpenForm(formId);
  }

  function handleBackToFormList() {
    setMobileDetailOpen(false);
    setActiveWorkspace(null);
    setShareView(null);
    setIframeUrl(null);
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Form Workspace</div>
          <h3 style={titleStyle}>特别活动表格</h3>
        </div>
        <div style={headerActionsStyle}>
          {props.canEditForms ? (
            <button type="button" style={primaryButtonStyle} onClick={props.onOpenCreate}>
              创建特别活动表
            </button>
          ) : null}
        </div>
      </header>

      {props.toast ? (
        <div style={props.toast.type === "success" ? successBannerStyle : errorBannerStyle}>{props.toast.text}</div>
      ) : null}

      {!props.canReadForms ? (
        <section style={panelStyle}>
          <div style={sectionEyebrowStyle}>Permission</div>
          <h4 style={sectionTitleStyle}>没有报名表工作台权限</h4>
          <div style={inlineNoteStyle}>需要 `form_read`、`form_edit` 或 `member_detail` 其中之一才能进入这里。</div>
        </section>
      ) : null}

      {props.canReadForms ? <div style={layoutStyle(isMobile)}>
        {!isMobile || !mobileDetailOpen ? <aside style={sidebarStyle(isMobile)}>
          {props.loading ? <div style={placeholderStyle}>加载报名表中…</div> : null}
          {!props.loading && !props.forms.length ? <div style={placeholderStyle}>暂无报名表</div> : null}
          {props.forms.map((form) => {
            const active = selectedForm?.id === form.id;
            return (
              <button key={form.id} type="button" style={formNavCardStyle(active)} onClick={() => handleOpenForm(form.id)}>
                <div style={formNavTitleStyle(active)}>{form.title}</div>
                <div style={formNavMetaStyle}>
                  截止 {form.expired || "-"} · 成员 {form.member_count ?? (form.members || []).length}
                </div>
              </button>
            );
          })}
        </aside> : null}

        {!isMobile || mobileDetailOpen ? <section className="form_detail_section" style={contentStyle}>
          {isMobile ? (
            <button type="button" style={mobileBackButtonStyle} onClick={handleBackToFormList}>
              ← 返回表格界面
            </button>
          ) : null}
          {!selectedForm ? <div style={placeholderStyle}>选择一个报名表开始编辑</div> : null}
          {selectedForm && props.detailLoading ? <div style={placeholderStyle}>正在加载详细资料…</div> : null}

          {selectedForm && !props.detailLoading && iframeUrl !== null ? (
            <IframeView url={iframeUrl} onBack={() => setIframeUrl(null)} />
          ) : null}

          {selectedForm && !props.detailLoading && shareView !== null && iframeUrl === null ? (
            <ShareFormView
              formId={selectedForm.id}
              title={selectedForm.title}
              {...(shareView === "share_payment"
                ? {
                    urlPath: `/api/form/pay_register/${selectedForm.id}`,
                    heading: "分享支付页面",
                    urlLabel: "支付页 URL",
                    downloadName: `form-${selectedForm.id}-pay-qrcode.png`,
                  }
                : {})}
              onBack={() => setShareView(null)}
              onOpenIframe={(url) => setIframeUrl(url)}
            />
          ) : null}

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null && activeWorkspaceItem === null ? (
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={sectionEyebrowStyle}>Summary Dashboard</div>
                  <h4 style={sectionTitleStyle}>{selectedForm.title}</h4>
                  <div style={dashboardSubtitleStyle}>
                    Form ID #{selectedForm.id} · 截止 {selectedForm.expired || "-"}
                  </div>
                </div>
                <div style={headerActionsStyle}>
                  <label style={toggleStyle}>
                    <input
                      type="checkbox"
                      checked={props.realtimeEnabled}
                      onChange={(event) => props.onToggleRealtime(event.target.checked)}
                    />
                    <span>实时同步</span>
                  </label>
                  <button type="button" style={secondaryButtonStyle} onClick={props.onRefresh}>
                    刷新
                  </button>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setShareView("share_payment")}>
                    分享支付页面
                  </button>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setShareView("share")}>
                    分享报名表格
                  </button>
                </div>
              </div>

              <div style={dashboardMetricGridStyle(isMobile)}>
                <DashboardMetric label="报名成员" value={String(memberCount)} detail={`已付款 ${paidMemberCount} · 处理中 ${pendingPaymentCount}`} />
                <DashboardMetric label="关联活动" value={String(linkedEvents.length)} detail={linkedEvents[0]?.event_name || "当前表格绑定的活动"} />
                <DashboardMetric label="报名费" value={String(props.fees.length)} detail="收费类别与付款资料" />
                <DashboardMetric label="表格内容" value={String(props.extraFields.length)} detail="额外填写项目" />
                <DashboardMetric label="字段开关" value={String(enabledFieldSwitchCount)} detail="已启用的默认字段" />
              </div>

              <div style={sectionDividerStyle} />
              <div style={workspaceIntroStyle}>
                <div>
                  <div style={sectionEyebrowStyle}>Workspaces</div>
                  <h4 style={workspaceIntroTitleStyle}>选择操作空间</h4>
                </div>
              </div>
              <div style={workspaceIconGridStyle(isMobile)}>
                {WORKSPACE_ITEMS.map((item) => (
                  <button key={item.key} type="button" style={workspaceIconButtonStyle} onClick={() => setActiveWorkspace(item.key)}>
                    <i className={item.icon} aria-hidden="true" style={workspaceIconStyle} />
                    <span style={workspaceIconTitleStyle}>{item.title}</span>
                    <span style={workspaceIconDescriptionStyle}>{item.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null && activeWorkspaceItem?.key === "settings" ? (
            <WorkspacePanel
              item={activeWorkspaceItem}
              onBack={() => setActiveWorkspace(null)}
              actions={
                props.canEditForms ? (
                  <button type="button" style={dangerButtonStyle} onClick={() => props.onDeleteForm(selectedForm.id)}>
                    删除表单
                  </button>
                ) : null
              }
            >
              <div style={summaryGridStyle(isMobile)}>
                <Field
                  label="标题"
                  value={selectedForm.title}
                  disabled={!props.canEditForms}
                  onChange={(value) => props.onPatchForm({ title: value })}
                />
                <Field
                  label="截止日期"
                  type="date"
                  value={selectedForm.expired || ""}
                  disabled={!props.canEditForms}
                  onChange={(value) => props.onPatchForm({ expired: value })}
                />
                <Field
                  label="详情"
                  value={selectedForm.detail || ""}
                  disabled={!props.canEditForms}
                  onChange={(value) => props.onPatchForm({ detail: value })}
                  textarea
                  textareaMinHeight="450px"
                  wide
                />
              </div>

              <div style={sectionDividerStyle} />
              <div style={sectionEyebrowStyle}>Field Switches</div>
              <div style={toggleGridStyle}>
                <ConfigToggle
                  label="启用 Email"
                  checked={Boolean(selectedForm.field_switches?.email ?? selectedForm.email)}
                  disabled={!props.canEditForms}
                  onChange={(next) => props.onPatchForm({ field_switches: { ...(selectedForm.field_switches || {}), email: next } })}
                />
                <ConfigToggle
                  label="家长同意书"
                  checked={Boolean(selectedForm.field_switches?.parental_form ?? selectedForm.parental_form)}
                  disabled={!props.canEditForms}
                  onChange={(next) =>
                    props.onPatchForm({ field_switches: { ...(selectedForm.field_switches || {}), parental_form: next } })
                  }
                />
                <ConfigToggle
                  label="家长 1"
                  checked={Boolean(selectedForm.field_switches?.parent_1 ?? selectedForm.parent_1)}
                  disabled={!props.canEditForms}
                  onChange={(next) =>
                    props.onPatchForm({
                      field_switches: { ...(selectedForm.field_switches || {}), parent_1: next, parent_1_phone: next },
                    })
                  }
                />
                <ConfigToggle
                  label="家长 2"
                  checked={Boolean(selectedForm.field_switches?.parent_2 ?? selectedForm.parent_2)}
                  disabled={!props.canEditForms}
                  onChange={(next) =>
                    props.onPatchForm({
                      field_switches: { ...(selectedForm.field_switches || {}), parent_2: next, parent_2_phone: next },
                    })
                  }
                />
                <ConfigToggle
                  label="居住地址"
                  checked={Boolean(selectedForm.field_switches?.address ?? selectedForm.address)}
                  disabled={!props.canEditForms}
                  onChange={(next) => props.onPatchForm({ field_switches: { ...(selectedForm.field_switches || {}), address: next } })}
                />
                <ConfigToggle
                  label="医疗备注"
                  checked={Boolean(selectedForm.field_switches?.medical ?? selectedForm.medical)}
                  disabled={!props.canEditForms}
                  onChange={(next) => props.onPatchForm({ field_switches: { ...(selectedForm.field_switches || {}), medical: next } })}
                />
                <ConfigToggle
                  label="过敏"
                  checked={Boolean(selectedForm.field_switches?.allergy ?? selectedForm.allergy)}
                  disabled={!props.canEditForms}
                  onChange={(next) => props.onPatchForm({ field_switches: { ...(selectedForm.field_switches || {}), allergy: next } })}
                />
                <ConfigToggle
                  label="其他备注"
                  checked={Boolean(selectedForm.field_switches?.other_remark ?? selectedForm.other_remark)}
                  disabled={!props.canEditForms}
                  onChange={(next) =>
                    props.onPatchForm({ field_switches: { ...(selectedForm.field_switches || {}), other_remark: next } })
                  }
                />
              </div>
            </WorkspacePanel>
          ) : null}

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null && activeWorkspaceItem?.key === "events" ? (
            <WorkspacePanel
              item={activeWorkspaceItem}
              onBack={() => setActiveWorkspace(null)}
              actions={
                props.canEditForms ? (
                  <button type="button" style={secondaryButtonStyle} onClick={props.onPickEvent}>
                    选择活动
                  </button>
                ) : null
              }
            >
              {!linkedEvents.length ? <div style={inlineNoteStyle}>当前未关联活动</div> : null}
              {linkedEvents.length ? (
                <div style={eventListStyle}>
                  {linkedEvents.map((event) => (
                    <LinkedEventCard
                      key={event.id}
                      event={event}
                      canEditForms={props.canEditForms}
                      onOpen={() => props.onOpenEventDetail(event.id)}
                      onRemove={() => props.onRemoveEvent(event.id)}
                    />
                  ))}
                </div>
              ) : null}
            </WorkspacePanel>
          ) : null}

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null && activeWorkspaceItem?.key === "fees" ? (
            <WorkspacePanel item={activeWorkspaceItem} onBack={() => setActiveWorkspace(null)}>
              <FeePanel
                formId={selectedForm.id}
                fees={props.fees}
                readOnly={!props.canEditForms}
                onAdd={props.onAddFee}
                onEdit={props.onEditFee}
                onDelete={props.onDeleteFee}
              />
            </WorkspacePanel>
          ) : null}

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null && activeWorkspaceItem?.key === "fields" ? (
            <WorkspacePanel item={activeWorkspaceItem} onBack={() => setActiveWorkspace(null)}>
              <div style={inlineNoteStyle}>
                中文姓名、英文姓名、NRIC、年龄、性别、邮箱、居住地址、医疗备注、过敏备注已经默认存在表格里。
                紧急联络人、交通等个别事项请在这里增添。
              </div>
              <ExtraFieldPanel
                fields={props.extraFields}
                readOnly={!props.canEditForms}
                onAdd={props.onAddExtraField}
                onEdit={props.onEditExtraField}
                onDelete={props.onDeleteExtraField}
              />
            </WorkspacePanel>
          ) : null}

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null && activeWorkspaceItem?.key === "members" ? (
            <WorkspacePanel
              item={activeWorkspaceItem}
              onBack={() => setActiveWorkspace(null)}
              actions={
                props.canViewMemberDetail ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void exportMembersToExcel(selectedForm.title, selectedForm.members || [], props.extraFields)}
                  >
                    下载 Excel
                  </button>
                ) : null
              }
            >
              {props.canViewMemberDetail ? (
                <MemberPanel
                  members={selectedForm.members || []}
                  extraFields={props.extraFields}
                  canEditMembers={props.canEditMembers}
                  parentalFormEnabled={parentalFormEnabled}
                  onRemove={props.onRemoveMember}
                  onShowDetail={props.onShowMemberDetail}
                  onOpenParental={props.onOpenParental}
                />
              ) : (
                <div style={inlineNoteStyle}>
                  这个表单目前共有 {selectedForm.member_count ?? (selectedForm.members || []).length} 位报名成员。
                  需要 `member_detail` 或 `form_edit` 权限才能查看详细资料。
                </div>
              )}
            </WorkspacePanel>
          ) : null}
        </section> : null}
      </div> : null}

      {props.createOpen && props.canEditForms ? <CreateFormModal onClose={props.onCloseCreate} onSubmit={props.onCreateForm} /> : null}
    </div>
  );
}

function DashboardMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={dashboardMetricStyle}>
      <div style={dashboardMetricLabelStyle}>{label}</div>
      <div style={dashboardMetricValueStyle}>{value}</div>
      <div style={dashboardMetricDetailStyle}>{detail}</div>
    </div>
  );
}

function WorkspacePanel({
  item,
  onBack,
  actions,
  children,
}: {
  item: WorkspaceItem;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div style={workspacePanelTitleGroupStyle}>
          <button type="button" style={workspaceBackButtonStyle} onClick={onBack}>
            ← 返回 Dashboard
          </button>
          <div>
            <div style={sectionEyebrowStyle}>{item.eyebrow}</div>
            <h4 style={sectionTitleStyle}>{item.title}</h4>
          </div>
        </div>
        {actions ? <div style={headerActionsStyle}>{actions}</div> : null}
      </div>
      <div style={sectionBodyStyle}>{children}</div>
    </section>
  );
}

function LinkedEventCard({
  event,
  canEditForms,
  onOpen,
  onRemove,
}: {
  event: FormEvent;
  canEditForms: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    let active = true;
    const imageId = event.event_image?.id;

    if (!imageId) {
      setImageUrl("");
      return () => {
        active = false;
      };
    }

    void smartImageURL(imageId, "cache")
      .then((url) => {
        if (active) {
          setImageUrl(url && !url.includes("broken-image.png") ? url : "");
        }
      })
      .catch(() => {
        if (active) {
          setImageUrl("");
        }
      });

    return () => {
      active = false;
    };
  }, [event.event_image?.id]);

  return (
    <article style={eventCardStyle}>
      <button type="button" style={eventCardMainButtonStyle} onClick={onOpen}>
        <div style={eventPosterWrapStyle}>
          {imageUrl ? (
            <CachedImage
              src={imageUrl}
              cacheKey={`form-linked-event:${event.id}:${event.event_image?.id || "poster"}`}
              alt={event.event_name || `活动 #${event.id}`}
              style={eventPosterStyle}
            />
          ) : (
            <div style={eventPosterPlaceholderStyle}>
              <i className="fa-solid fa-image" aria-hidden="true" />
            </div>
          )}
        </div>
        <div style={eventCardBodyStyle}>
          <div>
            <div style={eventTitleStyle}>{event.event_name || `活动 #${event.id}`}</div>
            <div style={eventMetaStyle}>Event ID #{event.id}</div>
          </div>
          <div style={eventMetaStyle}>{event.datetime || event.purpose || `活动 #${event.id}`}</div>
          <div style={chipRowStyle}>
            <span style={chipStyle}>地点 {event.location || "-"}</span>
            <span style={chipStyle}>类型 {event.type || "-"}</span>
            <span style={chipStyle}>对象 {event.target || "-"}</span>
          </div>
          <div style={eventOpenHintStyle}>点击进入创建活动详情</div>
        </div>
      </button>
      {canEditForms ? (
        <button type="button" style={ghostDangerStyle} onClick={onRemove}>
          移除
        </button>
      ) : null}
    </article>
  );
}

function ShareFormView({
  formId,
  title,
  urlPath,
  heading = "分享报名表格",
  urlLabel = "报名页 URL",
  downloadName,
  onBack,
  onOpenIframe,
}: {
  formId: number;
  title: string;
  urlPath?: string;
  heading?: string;
  urlLabel?: string;
  downloadName?: string;
  onBack: () => void;
  onOpenIframe: (url: string) => void;
}) {
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const formUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${urlPath ?? `/api/form/index/${formId}`}`
      : urlPath ?? `/api/form/index/${formId}`;

  useEffect(() => {
    let active = true;

    void QRCode.toDataURL(formUrl, {
      width: 240,
      margin: 1,
    })
      .then((url) => {
        if (active) {
          setQrCodeUrl(url);
        }
      })
      .catch(() => {
        if (active) {
          setStatus({ type: "error", text: "二维码生成失败" });
        }
      });

    return () => {
      active = false;
    };
  }, [formUrl]);

  useEffect(() => {
    if (!status) return undefined;
    const timer = window.setTimeout(() => setStatus(null), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formUrl);
      setStatus({ type: "success", text: "链接已复制" });
    } catch {
      setStatus({ type: "error", text: "复制失败" });
    }
  }

  function handleDownload() {
    if (!qrCodeUrl) {
      setStatus({ type: "error", text: "二维码尚未生成完成" });
      return;
    }

    downloadUrl(qrCodeUrl, downloadName ?? `form-${formId}-qrcode.png`);
  }

  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>Share</div>
          <h4 style={sectionTitleStyle}>{heading}</h4>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={onBack}>
          ← 返回
        </button>
      </div>

      <div style={shareInfoCardStyle}>
        <div style={fieldLabelStyle}>表格名称</div>
        <div style={shareTitleStyle}>{title}</div>
      </div>

      {status ? (
        <div style={status.type === "success" ? successBannerStyle : errorBannerStyle}>{status.text}</div>
      ) : null}

      <div style={shareGridStyle}>
        <div style={sectionStyle}>
          <div style={fieldLabelStyle}>{urlLabel}</div>
          <div style={urlBoxStyle}>{formUrl}</div>
          <div style={footerActionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={handleCopy}>
              Copy
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={() => onOpenIframe(formUrl)}>
              打开页面
            </button>
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={fieldLabelStyle}>QR Code</div>
          <div style={qrPreviewStyle}>
            {qrCodeUrl ? <CachedImage src={qrCodeUrl} alt={`报名表 ${title} 的二维码`} style={qrImageStyle} /> : <div style={inlineNoteStyle}>二维码生成中…</div>}
          </div>
          <div style={footerActionsStyle}>
            <button type="button" style={secondaryButtonStyle} onClick={handleDownload}>
              下载 QR Code
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function IframeView({ url, onBack }: { url: string; onBack: () => void }) {
  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>Preview</div>
          <h4 style={sectionTitleStyle}>{url}</h4>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={onBack}>
          ← 返回
        </button>
      </div>
      <iframe src={url} style={iframeStyle} title="页面预览" />
    </section>
  );
}

function CreateFormModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: FormCreatePayload) => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [expired, setExpired] = useState("");
  const [extras, setExtras] = useState<ExtraFieldDraft[]>([]);
  const [flags, setFlags] = useState({
    email: true,
    parental_form: false,
    parent_1: true,
    parent_2: false,
    address: false,
    medical: false,
    allergy: false,
    other_remark: false,
  });

  return (
    <div style={modalOverlayStyle}>
      <div style={modalStyle}>
        <div style={panelHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>Create</div>
            <h4 style={sectionTitleStyle}>新建报名表</h4>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={summaryGridStyle(false)}>
          <Field label="标题" value={title} onChange={setTitle} />
          <Field label="截止日期" type="date" value={expired} onChange={setExpired} />
          <Field label="详情" value={detail} onChange={setDetail} textarea wide />
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>配置开关</div>
          <div style={toggleGridStyle}>
            {Object.entries({
              email: "启用 Email",
              parental_form: "家长同意书",
              parent_1: "家长 1",
              parent_2: "家长 2",
              address: "居住地址",
              medical: "医疗备注",
              allergy: "过敏",
              other_remark: "其他备注",
            }).map(([key, label]) => (
              <ConfigToggle
                key={key}
                label={label}
                checked={Boolean(flags[key as keyof typeof flags])}
                onChange={(next) => setFlags((prev) => ({ ...prev, [key]: next }))}
              />
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>表格内容</div>
          <div style={stackStyle}>
            {extras.map((item, index) => (
              <ExtraFieldEditor
                key={index}
                initialValue={item}
                buttonLabel="更新字段"
                onSave={(payload) =>
                  setExtras((prev) => prev.map((entry, i) => (i === index ? normalizeExtraFieldDraft(payload, i) : entry)))
                }
                onDelete={() => setExtras((prev) => prev.filter((_, i) => i !== index))}
              />
            ))}
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => setExtras((prev) => [...prev, { label: "", field_type: "text", options: null, order: prev.length }])}
            >
              添加表格内容
            </button>
          </div>
        </div>

        <div style={footerActionsStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() =>
              onSubmit({
                title,
                detail,
                expired,
                ...flags,
                field_switches: {
                  ...flags,
                  parent_1_phone: flags.parent_1,
                  parent_2_phone: flags.parent_2,
                },
                parent_1_phone: flags.parent_1,
                parent_2_phone: flags.parent_2,
                extra_fields_config: extras
                  .filter((item) => item.label.trim())
                  .map((item, index) => normalizeExtraFieldDraft(item, index)),
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

function ExtraFieldPanel({
  fields,
  readOnly,
  onAdd,
  onEdit,
  onDelete,
}: {
  fields: ExtraFieldConfig[];
  readOnly?: boolean;
  onAdd: (payload: ExtraFieldDraft) => void;
  onEdit: (fieldId: number, payload: ExtraFieldDraft) => void;
  onDelete: (fieldId: number) => void;
}) {
  return (
    <div style={sectionBodyStyle}>
      {!readOnly ? (
        <ExtraFieldEditor buttonLabel="添加字段" onSave={(payload) => onAdd(normalizeExtraFieldDraft(payload, fields.length))} />
      ) : null}
      <div style={stackStyle}>
        {fields.length ? (
          fields.map((field) => (
            <ExtraFieldEditor
              key={field.id}
              initialValue={{
                label: field.label,
                field_type: field.field_type,
                options: field.options || null,
                order: field.order ?? null,
              }}
              buttonLabel="保存"
              readOnly={readOnly}
              onSave={(payload) => onEdit(field.id, normalizeExtraFieldDraft(payload, field.order ?? 0))}
              onDelete={() => onDelete(field.id)}
            />
          ))
        ) : (
          <div style={placeholderStyle}>暂无表格内容</div>
        )}
      </div>
    </div>
  );
}

function MemberPanel({
  members,
  extraFields,
  canEditMembers,
  parentalFormEnabled,
  onRemove,
  onShowDetail,
  onOpenParental,
}: {
  members: FormMember[];
  extraFields: ExtraFieldConfig[];
  canEditMembers: boolean;
  parentalFormEnabled: boolean;
  onRemove: (memberId: number) => void;
  onShowDetail: (member: FormMember) => void;
  onOpenParental: (member: FormMember) => void;
}) {
  const [memberQuery, setMemberQuery] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const filteredMembers = useMemo(() => {
    const keyword = memberQuery.trim().toLowerCase();
    if (!keyword) {
      return members;
    }

    return members.filter((member) => buildMemberSearchText(member, extraFields).includes(keyword));
  }, [extraFields, memberQuery, members]);
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / MEMBER_PAGE_SIZE));
  const safePage = Math.min(memberPage, totalPages);
  const pagedMembers = filteredMembers.slice((safePage - 1) * MEMBER_PAGE_SIZE, safePage * MEMBER_PAGE_SIZE);

  useEffect(() => {
    setMemberPage(1);
  }, [memberQuery, members.length]);

  useEffect(() => {
    setMemberPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <div style={sectionBodyStyle}>
      {!members.length ? <div style={placeholderStyle}>暂无报名成员</div> : null}
      {members.length ? (
        <>
          <div style={memberToolbarStyle}>
            <input
              type="search"
              placeholder="搜索姓名、NRIC、电话、Email、家长或表格内容"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              style={memberSearchInputStyle}
            />
            <div style={memberResultMetaStyle}>
              {filteredMembers.length} / {members.length} 位 · 第 {safePage} / {totalPages} 页
            </div>
          </div>
          {!filteredMembers.length ? <div style={placeholderStyle}>没有匹配的报名成员</div> : null}
          {filteredMembers.length ? <div style={memberListStyle}>
          {pagedMembers.map((member) => {
            const paymentMeta = getMemberPaymentStatusMeta(member);
            return (
              <article key={member.id} style={memberCardStyle}>
                <div style={memberPaymentTopRowStyle}>
                  <span
                    style={{
                      ...memberPaymentBadgeStyle,
                      color: paymentMeta.textColor,
                      background: paymentMeta.background,
                    }}
                  >
                    {paymentMeta.label}
                  </span>
                  <span style={memberPaymentHintStyle}>{paymentMeta.hint}</span>
                </div>
                <div style={memberHeaderStyle}>
                  <div>
                    <div style={memberNameStyle}>{member.name_cn || member.name || `成员 #${member.id}`}</div>
                    <div style={memberMetaStyle}>
                      {member.phone || "-"} · {member.email || "-"}
                    </div>
                  </div>
                  <div style={headerActionsStyle}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => onShowDetail(member)}>
                      {canEditMembers ? "详情 / 编辑" : "查看详情"}
                    </button>
                    {parentalFormEnabled || member.parental_data ? (
                      <button type="button" style={secondaryButtonStyle} onClick={() => onOpenParental(member)}>
                        {member.parental_data ? "家长同意书" : "发给家长签名"}
                      </button>
                    ) : null}
                    {canEditMembers ? (
                      <button type="button" style={ghostDangerStyle} onClick={() => onRemove(member.id)}>
                        移除
                      </button>
                    ) : null}
                  </div>
                </div>
                <div style={chipRowStyle}>
                  <span style={chipStyle}>ID {member.id}</span>
                  <span style={chipStyle}>性别 {String(member.gender || "-")}</span>
                  <span style={chipStyle}>NRIC {String(member.nric || "-")}</span>
                  <span style={chipStyle}>居住地址 {String(member.address || "-")}</span>
                  {Array.isArray(member.available_time_slot_json) ? (
                    <span style={chipStyle}>可用时段 {member.available_time_slot_json.length}</span>
                  ) : null}
                  {extraFields.map((field) => {
                    const values = member.extra_fields || member.field_values || [];
                    const match = values.find((item) => item.field_config_id === field.id);
                    return (
                      <span key={field.id} style={chipStyle}>
                        {field.label}: {formatExtraFieldValue(match?.field_value)}
                      </span>
                    );
                  })}
                </div>
              </article>
            );
          })}
          </div> : null}
          {filteredMembers.length > MEMBER_PAGE_SIZE ? (
            <div style={memberPaginationStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={safePage <= 1}
                onClick={() => setMemberPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={safePage >= totalPages}
                onClick={() => setMemberPage((current) => Math.min(totalPages, current + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  textarea,
  textareaMinHeight,
  wide,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  textarea?: boolean;
  textareaMinHeight?: string;
  wide?: boolean;
  type?: string;
}) {
  return (
    <label style={wide ? wideFieldStyle : fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {textarea ? (
        <textarea
          rows={4}
          style={textareaMinHeight ? { ...textareaStyle, minHeight: textareaMinHeight } : textareaStyle}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type={type}
          style={inputStyle}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function ConfigToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label style={configToggleStyle(checked)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
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
    member.id,
    member.name_cn,
    member.name,
    member.nric,
    member.phone,
    member.email,
    member.gender,
    member.address,
    member.parent_1,
    member.parent_1_phone,
    member.parent_2,
    member.parent_2_phone,
    member.medical,
    member.allergy,
    member.other_remark,
    extraFieldText,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function formatExtraFieldValue(value: unknown) {
  if (value == null || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    return value.join(", ") || "-";
  }
  return String(value);
}

function getMemberPaymentStatusMeta(member: FormMember) {
  const payments = Array.isArray(member.payments) ? member.payments : [];
  const latestPayment = payments[0];

  if (!latestPayment) {
    return {
      label: "未付款",
      hint: "还没有付款记录",
      textColor: "var(--x-color-ink-muted)",
      background: "var(--x-color-panel)",
    };
  }

  if (latestPayment.status === "checked") {
    return {
      label: "已付款",
      hint: `${payments.length} 笔付款记录`,
      textColor: "var(--x-color-success)",
      background: "var(--x-color-success-soft)",
    };
  }

  if (latestPayment.status === "fail") {
    return {
      label: "付款失败",
      hint: `${payments.length} 笔付款记录`,
      textColor: "var(--x-color-danger)",
      background: "var(--x-color-danger-soft)",
    };
  }

  return {
    label: "付款处理中",
    hint: `${payments.length} 笔付款记录`,
    textColor: "var(--x-color-warning)",
    background: "var(--x-color-warning-soft)",
  };
}

const pageStyle: CSSProperties = { display: "grid", gap: "10px" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap", paddingBottom: "8px", borderBottom: "1px solid var(--x-color-line-soft)" };
const eyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const titleStyle: CSSProperties = { margin: "4px 0 0", fontSize: "20px", lineHeight: 1.1, color: "var(--x-color-ink)" };
const headerActionsStyle: CSSProperties = { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" };
const toggleStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "6px", color: "var(--x-color-ink-muted)", fontSize: "12px" };
const primaryButtonStyle: CSSProperties = { padding: "7px 10px", borderRadius: "6px", border: "none", background: "var(--x-color-accent)", color: "white", fontWeight: 700, cursor: "pointer", fontSize: "13px" };
const secondaryButtonStyle: CSSProperties = { padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer", fontSize: "13px" };
const dangerButtonStyle: CSSProperties = { padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, cursor: "pointer", fontSize: "13px" };
const ghostDangerStyle: CSSProperties = { ...dangerButtonStyle };
const linkButtonStyle: CSSProperties = { ...secondaryButtonStyle, textDecoration: "none" };
const smallSecondaryButtonStyle: CSSProperties = { ...secondaryButtonStyle, padding: "6px 8px", fontSize: "12px" };
const smallDangerButtonStyle: CSSProperties = { ...dangerButtonStyle, padding: "6px 8px", fontSize: "12px" };
const smallLinkButtonStyle: CSSProperties = { ...linkButtonStyle, padding: "6px 8px", fontSize: "12px" };
const successBannerStyle: CSSProperties = { padding: "8px 10px", borderRadius: "6px", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" };
const errorBannerStyle: CSSProperties = { padding: "8px 10px", borderRadius: "6px", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
function layoutStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 300px) minmax(0, 1fr)", gap: "10px", alignItems: "start" };
}
function sidebarStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gap: "6px", position: isMobile ? "static" : "sticky", top: isMobile ? undefined : "68px" };
}
function formNavCardStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: "6px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    borderLeft: active ? "3px solid var(--x-color-accent)" : "3px solid transparent",
    background: active ? "var(--x-color-accent-tint)" : "var(--x-color-panel)",
    boxShadow: "none",
    textAlign: "left",
    cursor: "pointer",
  };
}
const formNavTitleStyle = (active: boolean): CSSProperties => ({ fontSize: "13px", fontWeight: 700, color: active ? "var(--x-color-accent)" : "var(--x-color-ink)" });
const formNavMetaStyle: CSSProperties = { marginTop: "3px", fontSize: "11px", color: "var(--x-color-ink-muted)" };
const contentStyle: CSSProperties = { display: "grid", gap: "10px", width: "100%", maxWidth: "700px" };
const panelStyle: CSSProperties = { padding: "10px", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", boxShadow: "none" };
const panelHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "8px" };
const mobileBackButtonStyle: CSSProperties = { ...secondaryButtonStyle, width: "fit-content" };
const sectionBodyStyle: CSSProperties = { display: "grid", gap: "8px" };
const sectionEyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const sectionTitleStyle: CSSProperties = { margin: "4px 0 0", fontSize: "18px", color: "var(--x-color-ink)" };
const placeholderStyle: CSSProperties = { padding: "10px", borderRadius: "6px", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink-muted)" };
const dashboardSubtitleStyle: CSSProperties = { marginTop: "4px", color: "var(--x-color-ink-muted)", fontSize: "12px" };
function dashboardMetricGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(5, minmax(0, 1fr))", gap: "8px" };
}
const dashboardMetricStyle: CSSProperties = { minHeight: "78px", padding: "10px", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", display: "grid", alignContent: "space-between", gap: "4px" };
const dashboardMetricLabelStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "11px", fontWeight: 700 };
const dashboardMetricValueStyle: CSSProperties = { color: "var(--x-color-ink)", fontSize: "24px", lineHeight: 1, fontWeight: 800 };
const dashboardMetricDetailStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "11px", lineHeight: 1.35, overflowWrap: "anywhere" };
const workspaceIntroStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "8px" };
const workspaceIntroTitleStyle: CSSProperties = { ...sectionTitleStyle, fontSize: "16px" };
function workspaceIconGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(5, minmax(128px, 1fr))", gap: "8px" };
}
const workspaceIconButtonStyle: CSSProperties = { minHeight: "148px", padding: "14px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", display: "grid", justifyItems: "center", alignContent: "center", gap: "8px", textAlign: "center", cursor: "pointer" };
const workspaceIconStyle: CSSProperties = { fontSize: "34px", color: "var(--x-color-accent)" };
const workspaceIconTitleStyle: CSSProperties = { fontSize: "15px", fontWeight: 800, lineHeight: 1.2 };
const workspaceIconDescriptionStyle: CSSProperties = { maxWidth: "180px", fontSize: "12px", lineHeight: 1.35, color: "var(--x-color-ink-muted)" };
const workspacePanelTitleGroupStyle: CSSProperties = { display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" };
const workspaceBackButtonStyle: CSSProperties = { ...secondaryButtonStyle, whiteSpace: "nowrap" };
function summaryGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gap: "8px", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))" };
}
const fieldStyle: CSSProperties = { display: "grid", gap: "4px" };
const wideFieldStyle: CSSProperties = { ...fieldStyle, gridColumn: "1 / -1" };
const fieldLabelStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", minHeight: "32px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", boxSizing: "border-box", fontSize: "13px" };
const textareaStyle: CSSProperties = { ...inputStyle, resize: "vertical", minHeight: "84px" };
const sectionDividerStyle: CSSProperties = { height: "1px", margin: "10px 0 8px", background: "var(--x-color-line-soft)" };
const toggleGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "6px" };
const configToggleStyle = (checked: boolean): CSSProperties => ({ display: "flex", gap: "6px", alignItems: "center", padding: "7px 9px", borderRadius: "6px", border: checked ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", background: checked ? "var(--x-color-accent-tint)" : "var(--x-color-panel-strong)", color: "var(--x-color-ink)" });
const inlineNoteStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "12px" };
const eventListStyle: CSSProperties = { display: "grid", gap: "6px" };
const eventCardStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "start", padding: "8px", borderRadius: "8px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)" };
const eventCardMainButtonStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(96px, 140px) minmax(0, 1fr)", gap: "10px", width: "100%", padding: 0, border: "none", background: "transparent", color: "var(--x-color-ink)", textAlign: "left", cursor: "pointer" };
const eventPosterWrapStyle: CSSProperties = { width: "100%", aspectRatio: "4 / 3", minHeight: "96px", overflow: "hidden", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const eventPosterStyle: CSSProperties = { width: "100%", height: "100%", display: "block", objectFit: "cover" };
const eventPosterPlaceholderStyle: CSSProperties = { width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)", fontSize: "28px", background: "var(--x-color-panel)" };
const eventCardBodyStyle: CSSProperties = { minWidth: 0, display: "grid", gap: "5px", alignContent: "start" };
const eventTitleStyle: CSSProperties = { fontWeight: 700, color: "var(--x-color-ink)" };
const eventMetaStyle: CSSProperties = { marginTop: "4px", fontSize: "13px", color: "var(--x-color-ink-muted)" };
const eventOpenHintStyle: CSSProperties = { marginTop: "2px", fontSize: "12px", fontWeight: 700, color: "var(--x-color-accent)" };
const sectionStyle: CSSProperties = { marginTop: "10px", display: "grid", gap: "8px" };
const stackStyle: CSSProperties = { display: "grid", gap: "6px" };
const footerActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "10px", flexWrap: "wrap" };
const modalOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "12px", background: "rgba(15, 23, 42, 0.5)" };
const iframeStyle: CSSProperties = { width: "100%", height: "70vh", border: "none", borderRadius: "6px", background: "var(--x-color-panel)" };
const modalStyle: CSSProperties = { width: "min(980px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "12px", borderRadius: "8px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 12px 28px var(--x-color-shadow-medium)" };const inlineEditorRowStyle: CSSProperties = { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" };
const feeEditorStyle: CSSProperties = { ...inlineEditorRowStyle, alignItems: "stretch" };
const feeImageControlStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" };
const compactInputStyle: CSSProperties = { minWidth: "120px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)" };
const feeEditorCardStyle: CSSProperties = { display: "grid", gap: "8px", padding: "10px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)" };
const feeEditorGridStyle: CSSProperties = { display: "grid", gap: "8px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" };
const feeTextareaStyle: CSSProperties = { ...inputStyle, minHeight: "88px", resize: "vertical" };
const feeImageSectionStyle: CSSProperties = { display: "grid", gap: "10px" };
const feeImagePreviewStyle: CSSProperties = { display: "inline-flex", width: "fit-content", textDecoration: "none" };
const feeImageStyle: CSSProperties = { display: "block", width: "100%", maxWidth: "220px", maxHeight: "160px", objectFit: "cover", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const feeImageEmptyStyle: CSSProperties = { padding: "10px", borderRadius: "6px", border: "1px dashed var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", fontSize: "13px", background: "var(--x-color-panel)" };
const feeActionRowStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" };
const memberToolbarStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "center" };
const memberSearchInputStyle: CSSProperties = { ...inputStyle, minHeight: "34px" };
const memberResultMetaStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" };
const memberListStyle: CSSProperties = { display: "grid", gap: "6px" };
const memberCardStyle: CSSProperties = { padding: "10px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)" };
const memberPaginationStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "6px", flexWrap: "wrap" };
const memberPaymentTopRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" };
const memberPaymentBadgeStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "fit-content", padding: "4px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 800 };
const memberPaymentHintStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const memberHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" };
const memberNameStyle: CSSProperties = { fontWeight: 800, color: "var(--x-color-ink)" };
const memberMetaStyle: CSSProperties = { marginTop: "3px", color: "var(--x-color-ink-muted)", fontSize: "12px" };
const chipRowStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" };
const chipStyle: CSSProperties = { padding: "4px 7px", borderRadius: "999px", background: "var(--x-color-accent-tint-strong)", color: "var(--x-color-ink)", fontSize: "11px" };
const shareGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px", alignItems: "start" };
const shareInfoCardStyle: CSSProperties = { padding: "10px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", display: "grid", gap: "4px" };
const shareTitleStyle: CSSProperties = { fontSize: "16px", fontWeight: 700, color: "var(--x-color-ink)" };
const urlBoxStyle: CSSProperties = { padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", wordBreak: "break-all" };
const qrPreviewStyle: CSSProperties = { minHeight: "220px", padding: "10px", borderRadius: "6px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", display: "grid", placeItems: "center" };
const qrImageStyle: CSSProperties = { width: "100%", maxWidth: "240px", height: "auto", display: "block" };
