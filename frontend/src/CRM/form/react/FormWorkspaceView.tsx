import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import QRCode from "qrcode";

import { CachedImage } from "../../../components/CachedMedia";
import { downloadUrl } from "../../../js/browserActions";
import { ExtraFieldEditor } from "./ExtraFieldEditor";
import { FeePanel } from "./FeePanel";
import type { ExtraFieldDraft } from "./ExtraFieldEditor";
import type { ExtraFieldConfig, FormCreatePayload, FormFee, FormMember, FormRecord } from "./types";

type Toast = { type: "success" | "error"; text: string } | null;

type FeePayload = {
  category: string;
  amount: string;
  age_range_from?: string;
  age_range_to?: string;
  description?: string;
  image_path?: string | null;
};

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
  const [collapsedSections, setCollapsedSections] = useState({
    event: true,
    fees: true,
    extraFields: true,
    members: true,
  });

  useEffect(() => {
    setCollapsedSections({
      event: true,
      fees: true,
      extraFields: true,
      members: true,
    });
    setShareView(null);
    setIframeUrl(null);
  }, [selectedForm?.id]);

  function toggleSection(section: keyof typeof collapsedSections) {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Form Workspace</div>
          <h3 style={titleStyle}>创建报名表格</h3>
        </div>
        <div style={headerActionsStyle}>
          {props.canEditForms ? (
            <button type="button" style={primaryButtonStyle} onClick={props.onOpenCreate}>
              创建报名表
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
        <aside style={sidebarStyle(isMobile)}>
          {props.loading ? <div style={placeholderStyle}>加载报名表中…</div> : null}
          {!props.loading && !props.forms.length ? <div style={placeholderStyle}>暂无报名表</div> : null}
          {props.forms.map((form) => {
            const active = selectedForm?.id === form.id;
            return (
              <button key={form.id} type="button" style={formNavCardStyle(active)} onClick={() => props.onOpenForm(form.id)}>
                <div style={formNavTitleStyle(active)}>{form.title}</div>
                <div style={formNavMetaStyle}>
                  截止 {form.expired || "-"} · 成员 {form.member_count ?? (form.members || []).length}
                </div>
              </button>
            );
          })}
        </aside>

        <section className="form_detail_section" style={contentStyle}>
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

          {selectedForm && !props.detailLoading && shareView === null && iframeUrl === null ? (
            <>
              <section style={panelStyle}>
                <div style={panelHeaderStyle}>
                  <div>
                    <div style={sectionEyebrowStyle}>Summary</div>
                    <h4 style={sectionTitleStyle}>{selectedForm.title}</h4>
                  </div>
                  <div style={headerActionsStyle}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => setShareView("share_payment")}>
                      分享支付页面
                    </button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => setShareView("share")}>
                      分享报名表格
                    </button>
                    {props.canEditForms ? (
                      <button type="button" style={dangerButtonStyle} onClick={() => props.onDeleteForm(selectedForm.id)}>
                        删除表单
                      </button>
                    ) : null}
                  </div>
                </div>

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
              </section>

              <CollapsibleSection
                eyebrow="Event"
                title="关联活动"
                collapsed={collapsedSections.event}
                onToggle={() => toggleSection("event")}
                actions={props.canEditForms ? (
                  <button type="button" style={secondaryButtonStyle} onClick={props.onPickEvent}>
                    选择活动
                  </button>
                ) : null}
              >
                {!linkedEvents.length ? <div style={inlineNoteStyle}>当前未关联活动</div> : null}
                {linkedEvents.length ? (
                  <div style={eventListStyle}>
                    {linkedEvents.map((event) => (
                      <div key={event.id} style={eventCardStyle}>
                        <div>
                          <div style={eventTitleStyle}>{event.event_name || `活动 #${event.id}`}</div>
                          <div style={eventMetaStyle}>Event ID #{event.id}</div>
                          <div style={eventMetaStyle}>{event.datetime || event.purpose || `活动 #${event.id}`}</div>
                        </div>
                        {props.canEditForms ? (
                          <button type="button" style={ghostDangerStyle} onClick={() => props.onRemoveEvent(event.id)}>
                            移除
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </CollapsibleSection>

              <CollapsibleSection
                eyebrow="Fees"
                title="报名费"
                collapsed={collapsedSections.fees}
                onToggle={() => toggleSection("fees")}
              >
                <FeePanel
                  formId={selectedForm.id}
                  fees={props.fees}
                  readOnly={!props.canEditForms}
                  onAdd={props.onAddFee}
                  onEdit={props.onEditFee}
                  onDelete={props.onDeleteFee}
                />
              </CollapsibleSection>

                <CollapsibleSection
                  eyebrow="Extra Fields"
                  title={
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>表格内容</span>
                      <small style={{ color: "#6b7280", fontSize: 12, fontWeight: 400 }}>
                        (中文姓名，英文姓名，NRIC，年龄，性别，邮箱，居住地址，医疗备注，过敏备注 ) 这9项已经默认存在表格里
                        (紧急联络人，交通.... 等等 ， 其他各别事项请在下方增添）
                      </small>
                    </span>
                  }
                  collapsed={collapsedSections.extraFields}
                  onToggle={() => toggleSection("extraFields")}
                >
                <ExtraFieldPanel
                  fields={props.extraFields}
                  readOnly={!props.canEditForms}
                  onAdd={props.onAddExtraField}
                  onEdit={props.onEditExtraField}
                  onDelete={props.onDeleteExtraField}
                />
              </CollapsibleSection>

              <CollapsibleSection
                eyebrow="Members"
                title="报名成员"
                collapsed={collapsedSections.members}
                onToggle={() => toggleSection("members")}
                actions={props.canViewMemberDetail ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void exportMembersToExcel(selectedForm.title, selectedForm.members || [], props.extraFields)}
                  >
                    下载 Excel
                  </button>
                ) : null}
              >
                {props.canViewMemberDetail ? (
                  <MemberPanel
                    members={selectedForm.members || []}
                    extraFields={props.extraFields}
                    canEditMembers={props.canEditMembers}
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
              </CollapsibleSection>
            </>
          ) : null}
        </section>
      </div> : null}

      {props.createOpen && props.canEditForms ? <CreateFormModal onClose={props.onCloseCreate} onSubmit={props.onCreateForm} /> : null}
    </div>
  );
}

function CollapsibleSection({
  eyebrow,
  title,
  collapsed,
  onToggle,
  actions,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={panelStyle}>
      <div style={panelHeaderStyle}>
        <button type="button" style={sectionToggleButtonStyle} onClick={onToggle}>
          <div>
            <div style={sectionEyebrowStyle}>{eyebrow}</div>
            <h4 style={sectionTitleStyle}>{title}</h4>
          </div>
          <span style={sectionToggleIconStyle}>{collapsed ? "展开" : "收起"}</span>
        </button>
        {actions}
      </div>
      {!collapsed ? children : null}
    </section>
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
  onRemove,
  onShowDetail,
  onOpenParental,
}: {
  members: FormMember[];
  extraFields: ExtraFieldConfig[];
  canEditMembers: boolean;
  onRemove: (memberId: number) => void;
  onShowDetail: (member: FormMember) => void;
  onOpenParental: (member: FormMember) => void;
}) {
  return (
    <div style={sectionBodyStyle}>
      {!members.length ? <div style={placeholderStyle}>暂无报名成员</div> : null}
      {members.length ? (
        <div style={memberListStyle}>
          {members.map((member) => {
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
                    {member.parental_data ? (
                      <button type="button" style={secondaryButtonStyle} onClick={() => onOpenParental(member)}>
                        家长同意书
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
        </div>
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
  wide,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  textarea?: boolean;
  wide?: boolean;
  type?: string;
}) {
  return (
    <label style={wide ? wideFieldStyle : fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {textarea ? (
        <textarea
          rows={4}
          style={textareaStyle}
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

const pageStyle: CSSProperties = { display: "grid", gap: "18px" };
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" };
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const titleStyle: CSSProperties = { margin: "8px 0 0", fontSize: "30px", lineHeight: 1.1, color: "var(--x-color-ink)" };
const headerActionsStyle: CSSProperties = { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" };
const toggleStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", color: "var(--x-color-ink-muted)", fontSize: "14px" };
const primaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer" };
const dangerButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, cursor: "pointer" };
const ghostDangerStyle: CSSProperties = { ...dangerButtonStyle, padding: "10px 14px" };
const linkButtonStyle: CSSProperties = { ...secondaryButtonStyle, textDecoration: "none" };
const smallSecondaryButtonStyle: CSSProperties = { ...secondaryButtonStyle, padding: "8px 12px", fontSize: "13px" };
const smallDangerButtonStyle: CSSProperties = { ...dangerButtonStyle, padding: "8px 12px", fontSize: "13px" };
const smallLinkButtonStyle: CSSProperties = { ...linkButtonStyle, padding: "8px 12px", fontSize: "13px" };
const successBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" };
const errorBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
function layoutStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 320px) minmax(0, 1fr)", gap: "20px", alignItems: "start" };
}
function sidebarStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gap: "12px", position: isMobile ? "static" : "sticky", top: isMobile ? undefined : "84px" };
}
function formNavCardStyle(active: boolean): CSSProperties {
  return {
    padding: "16px",
    borderRadius: "var(--x-radius-md)",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: active ? "linear-gradient(145deg, var(--x-color-accent-tint-strong), var(--x-color-info-tint))" : "var(--x-color-panel-strong)",
    boxShadow: active ? "0 18px 34px var(--x-color-shadow-medium)" : "0 10px 24px var(--x-color-shadow-soft)",
    textAlign: "left",
    cursor: "pointer",
  };
}
const formNavTitleStyle = (active: boolean): CSSProperties => ({ fontSize: "16px", fontWeight: 700, color: active ? "var(--x-color-accent)" : "var(--x-color-ink)" });
const formNavMetaStyle: CSSProperties = { marginTop: "6px", fontSize: "13px", color: "var(--x-color-ink-muted)" };
const contentStyle: CSSProperties = { display: "grid", gap: "18px" };
const panelStyle: CSSProperties = { padding: "18px", borderRadius: "var(--x-radius-lg)", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", boxShadow: "0 18px 34px var(--x-color-shadow-soft)" };
const panelHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "14px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "14px" };
const sectionToggleButtonStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "14px", flex: 1, minWidth: "260px", padding: 0, border: "none", background: "transparent", textAlign: "left", cursor: "pointer" };
const sectionToggleIconStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)", whiteSpace: "nowrap" };
const sectionBodyStyle: CSSProperties = { display: "grid", gap: "12px" };
const sectionInlineActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" };
const sectionEyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const sectionTitleStyle: CSSProperties = { margin: "6px 0 0", fontSize: "22px", color: "var(--x-color-ink)" };
const placeholderStyle: CSSProperties = { padding: "18px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink-muted)" };
function summaryGridStyle(isMobile: boolean): CSSProperties {
  return { display: "grid", gap: "14px", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))" };
}
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const wideFieldStyle: CSSProperties = { ...fieldStyle, gridColumn: "1 / -1" };
const fieldLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: "12px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", boxSizing: "border-box" };
const textareaStyle: CSSProperties = { ...inputStyle, resize: "vertical", minHeight: "110px" };
const sectionDividerStyle: CSSProperties = { height: "1px", margin: "18px 0 14px", background: "var(--x-color-line-soft)" };
const toggleGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" };
const configToggleStyle = (checked: boolean): CSSProperties => ({ display: "flex", gap: "10px", alignItems: "center", padding: "12px 14px", borderRadius: "14px", border: checked ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)", background: checked ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel-strong)", color: "var(--x-color-ink)" });
const inlineNoteStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "14px" };
const eventListStyle: CSSProperties = { display: "grid", gap: "10px" };
const eventCardStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", padding: "14px", borderRadius: "14px", background: "var(--x-color-panel-strong)", border: "1px solid var(--x-color-line-soft)" };
const eventTitleStyle: CSSProperties = { fontWeight: 700, color: "var(--x-color-ink)" };
const eventMetaStyle: CSSProperties = { marginTop: "4px", fontSize: "13px", color: "var(--x-color-ink-muted)" };
const sectionStyle: CSSProperties = { marginTop: "14px", display: "grid", gap: "12px" };
const stackStyle: CSSProperties = { display: "grid", gap: "10px" };
const footerActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px", flexWrap: "wrap" };
const modalOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "22px", background: "rgba(15, 23, 42, 0.5)" };
const iframeStyle: CSSProperties = { width: "100%", height: "70vh", border: "none", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel)" };
const modalStyle: CSSProperties = { width: "min(980px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "20px", borderRadius: "var(--x-radius-lg)", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 28px 56px var(--x-color-shadow-medium)" };const inlineEditorRowStyle: CSSProperties = { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" };
const feeEditorStyle: CSSProperties = { ...inlineEditorRowStyle, alignItems: "stretch" };
const feeImageControlStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" };
const compactInputStyle: CSSProperties = { minWidth: "120px", padding: "10px 12px", borderRadius: "12px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)" };
const feeEditorCardStyle: CSSProperties = { display: "grid", gap: "14px", padding: "14px", borderRadius: "16px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)" };
const feeEditorGridStyle: CSSProperties = { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" };
const feeTextareaStyle: CSSProperties = { ...inputStyle, minHeight: "88px", resize: "vertical" };
const feeImageSectionStyle: CSSProperties = { display: "grid", gap: "10px" };
const feeImagePreviewStyle: CSSProperties = { display: "inline-flex", width: "fit-content", textDecoration: "none" };
const feeImageStyle: CSSProperties = { display: "block", width: "100%", maxWidth: "220px", maxHeight: "160px", objectFit: "cover", borderRadius: "14px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const feeImageEmptyStyle: CSSProperties = { padding: "18px", borderRadius: "14px", border: "1px dashed var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", fontSize: "13px", background: "var(--x-color-panel)" };
const feeActionRowStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" };
const memberListStyle: CSSProperties = { display: "grid", gap: "12px" };
const memberCardStyle: CSSProperties = { padding: "16px", borderRadius: "16px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)" };
const memberPaymentTopRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" };
const memberPaymentBadgeStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "fit-content", padding: "6px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 800 };
const memberPaymentHintStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const memberHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" };
const memberNameStyle: CSSProperties = { fontWeight: 800, color: "var(--x-color-ink)" };
const memberMetaStyle: CSSProperties = { marginTop: "6px", color: "var(--x-color-ink-muted)", fontSize: "13px" };
const chipRowStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" };
const chipStyle: CSSProperties = { padding: "8px 10px", borderRadius: "999px", background: "var(--x-color-accent-tint-strong)", color: "var(--x-color-ink)", fontSize: "12px" };
const shareGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px", alignItems: "start" };
const shareInfoCardStyle: CSSProperties = { padding: "14px 16px", borderRadius: "14px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", display: "grid", gap: "6px" };
const shareTitleStyle: CSSProperties = { fontSize: "16px", fontWeight: 700, color: "var(--x-color-ink)" };
const urlBoxStyle: CSSProperties = { padding: "12px 14px", borderRadius: "14px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", wordBreak: "break-all" };
const qrPreviewStyle: CSSProperties = { minHeight: "268px", padding: "16px", borderRadius: "16px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", display: "grid", placeItems: "center" };
const qrImageStyle: CSSProperties = { width: "100%", maxWidth: "240px", height: "auto", display: "block" };
