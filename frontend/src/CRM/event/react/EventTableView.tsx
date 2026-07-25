import { useRef, useState, type CSSProperties, type FormEvent, type RefObject } from "react";

import { CachedImage } from "../../../components/CachedMedia";
import { openPreviewModal } from "../../../js/attachment_preview";
import { downloadUrlOrShare } from "../../../js/browserActions";
import { show_alert } from "../../../js/show_alert";
import { openBrochurePreviewModal } from "../../../event/shared/brochurePreview";
import { buildEventTypeChoices } from "../../../event/shared/eventTypes";
import { TablePagination, usePagedRows } from "../../shared/TablePagination";
import { EventAgentTab } from "./EventAgentTab";
import { EventBudgetTab } from "./EventBudgetTab";
import { EventCheckinTab } from "./EventCheckinTab";
import { EventFlowTab } from "./EventFlowTab";
import { EventTaskTab } from "./EventTaskTab";
import type { EventCreatePayload, EventMutationPayload, EventRecord } from "./types";
import type { FormRecord } from "../../form/react/types";

type Toast = { type: "success" | "error"; text: string } | null;
type CreateDraft = {
  event_name: string;
  datetime: string;
  end_datetime: string;
  location: string;
  type: string;
  target: string;
  purpose: string;
};

const TABS: { key: string; label: string; icon: string }[] = [
  { key: "settings", label: "基本设置", icon: "fa-solid fa-sliders" },
  { key: "media", label: "海报与附件", icon: "fa-solid fa-image" },
  { key: "organizers", label: "组织者", icon: "fa-solid fa-users" },
  { key: "form", label: "关联报名表", icon: "fa-solid fa-clipboard-list" },
  { key: "checkin", label: "签到", icon: "fa-solid fa-clipboard-check" },
  { key: "flow", label: "流程", icon: "fa-solid fa-list-ol" },
  { key: "tasks", label: "待办", icon: "fa-solid fa-list-check" },
  { key: "budget", label: "预算", icon: "fa-solid fa-coins" },
  { key: "agent", label: "AI Agent", icon: "fa-solid fa-robot" },
];

function findEventForm(forms: FormRecord[], eventId: number): FormRecord | null {
  return (
    forms.find(
      (form) =>
        form.event_id === eventId ||
        form.event?.id === eventId ||
        Boolean(form.events?.some((event) => event.id === eventId)),
    ) ?? null
  );
}

export function EventTableView(props: {
  isMobile?: boolean;
  canEditEvent?: boolean;
  events: EventRecord[];
  forms: FormRecord[];
  selectedEvent: EventRecord | null;
  selectedEventId: number | null;
  selectedEventForm: FormRecord | null;
  activeTab: string;
  query: string;
  selectedType: string;
  eventTypeOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  creating: boolean;
  posterUploading: boolean;
  brochureUploading: boolean;
  attachmentUploading: boolean;
  toast: Toast;
  imageUrl: string | null;
  onQueryChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onSelectEvent: (eventId: number) => void;
  onBackToList: () => void;
  onSelectTab: (tab: string) => void;
  onRefresh: () => void;
  onAddOrganizers: () => void;
  onCreateEvent: (payload: EventCreatePayload) => Promise<boolean>;
  onUpdateEvent: (patch: EventMutationPayload) => void;
  onUploadPoster: (file: File) => void;
  onUploadBrochure: (file: File) => void;
  onRemoveBrochure: () => void;
  onUploadAttachment: (files: File[]) => void;
  onRemoveAttachment: (fileId: number) => void;
  onDeleteEvent: () => void;
  onOpenFormContent: (formId: number) => void;
}) {
  const isMobile = props.isMobile ?? false;
  const canEditEvent = props.canEditEvent ?? false;
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(() => createDefaultDraft());
  const [createError, setCreateError] = useState<string | null>(null);
  const posterInputRef = useRef<HTMLInputElement | null>(null);
  const brochureInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const eventTypeChoices = buildEventTypeChoices(
    props.eventTypeOptions.map((option) => option.value).filter((value) => !String(value).startsWith("__")),
  );

  const paged = usePagedRows(props.events, 15, `${props.query}|${props.selectedType}`);

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    const success = await props.onCreateEvent({
      event_name: draft.event_name.trim(),
      datetime: draft.datetime,
      end_datetime: draft.end_datetime || undefined,
      location: draft.location.trim() || undefined,
      type: draft.type.trim() || undefined,
      target: draft.target.trim() || undefined,
      purpose: draft.purpose.trim() || undefined,
    });
    if (success) {
      setCreateOpen(false);
      setDraft(createDefaultDraft());
      setCreateError(null);
    }
  }

  async function handleDownloadEventFile(filePath: string, fileName?: string | null, mimeType?: string | null) {
    const url = `/media_file/${filePath}`;
    const filename = fileName || filePath.split("/").pop() || "event-file";
    try {
      await downloadUrlOrShare(url, filename, {
        isMobile,
        title: filename,
        text: filename,
        fallbackUrl: `${window.location.origin}${url}`,
        mimeType: mimeType || undefined,
      });
    } catch (error) {
      show_alert("error", error instanceof Error ? error.message : "下载失败");
    }
  }

  const inDetail = props.selectedEventId != null;
  const event = props.selectedEvent;

  return (
    <div style={pageStyle}>
      <style>{TABLE_CSS}</style>
      <datalist id="event-type-options">
        {eventTypeChoices.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      {props.toast ? (
        <div style={props.toast.type === "success" ? successStyle : errorStyle}>{props.toast.text}</div>
      ) : null}
      {!canEditEvent ? (
        <div style={errorStyle}>
          当前账号只有活动读取权限。新增、修改、删除、上传和团队维护都需要 <code>event_edit</code>。
        </div>
      ) : null}

      <section style={panelStyle}>
        {!inDetail ? (
          <>
            <div style={toolbarStyle(isMobile)}>
              <div>
                <div style={eyebrowStyle}>CRM / 活动</div>
                <h3 style={panelTitleStyle}>创建活动</h3>
                <div style={mutedStyle}>共 {props.events.length} 个活动</div>
              </div>
              <div style={headerRightStyle(isMobile)}>
                <button type="button" style={btnStyle} disabled={props.loading} onClick={props.onRefresh}>
                  {props.loading ? "刷新中…" : "刷新"}
                </button>
                {canEditEvent ? (
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={() => {
                      setDraft(createDefaultDraft());
                      setCreateError(null);
                      setCreateOpen(true);
                    }}
                  >
                    新建活动
                  </button>
                ) : null}
              </div>
            </div>

            <div style={filterRowStyle(isMobile)}>
              <input
                placeholder="搜索活动名称 / 地点 / 对象 / 筹备团队"
                value={props.query}
                onChange={(e) => props.onQueryChange(e.target.value)}
                style={searchInputStyle}
              />
              <select value={props.selectedType} onChange={(e) => props.onTypeChange(e.target.value)} style={selectStyle}>
                {props.eventTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {props.loading && !props.events.length ? (
              <div style={emptyStyle}>读取活动中…</div>
            ) : !props.events.length ? (
              <div style={emptyStyle}>没有匹配的活动。</div>
            ) : (
              <div style={{ padding: "0 14px 14px" }}>
                <TablePagination page={paged.page} totalPages={paged.totalPages} total={paged.total} onPage={paged.setPage} />
                <div style={tableWrapStyle}>
                  <table className="fw-table">
                    <thead>
                      <tr>
                        <th>活动名称</th>
                        <th>日期时间</th>
                        <th>地点</th>
                        <th>类型</th>
                        <th>关联报名表</th>
                        <th>创建人</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.pageRows.map((row) => {
                        const linkedForm = findEventForm(props.forms, row.id);
                        return (
                          <tr key={row.id} className="fw-row" onClick={() => props.onSelectEvent(row.id)}>
                            <td>
                              <div style={cellStrongStyle}>{row.event_name || `活动 #${row.id}`}</div>
                              <div style={cellSubStyle}>#{row.id}</div>
                            </td>
                            <td style={monoCellStyle}>{formatEventDateTime(row.datetime)}</td>
                            <td>{row.location || "—"}</td>
                            <td>{row.type || "—"}</td>
                            <td>{linkedForm ? linkedForm.title || `#${linkedForm.id}` : "—"}</td>
                            <td>{row.display_name || row.username || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={headerStyle(isMobile)}>
              <div style={headerLeftStyle}>
                <button type="button" style={btnStyle} onClick={props.onBackToList}>
                  ← 返回列表
                </button>
                <div>
                  <div style={eyebrowStyle}>活动 #{props.selectedEventId}</div>
                  <h3 style={panelTitleStyle}>{event ? event.event_name || `活动 #${event.id}` : "加载中…"}</h3>
                  <div style={mutedStyle}>
                    {event
                      ? [formatEventDateTime(event.datetime), event.location].filter(Boolean).join(" · ") || "暂无时间/地点"
                      : ""}
                  </div>
                </div>
              </div>
              <div style={headerRightStyle(isMobile)}>
                <button type="button" style={btnStyle} disabled={props.loading} onClick={props.onRefresh}>
                  {props.loading ? "刷新中…" : "刷新"}
                </button>
                {canEditEvent ? (
                  <button type="button" style={dangerButtonStyle} onClick={props.onDeleteEvent}>
                    删除活动
                  </button>
                ) : null}
              </div>
            </div>

            <div style={tabBarWrapStyle}>
              <div style={tabBarStyle}>
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    style={props.activeTab === tab.key ? tabActiveStyle : tabStyle}
                    onClick={() => props.onSelectTab(tab.key)}
                  >
                    <i className={tab.icon} aria-hidden="true" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={bodyStyle}>
              {!event ? (
                <div style={emptyStyle}>加载中…</div>
              ) : props.activeTab === "media" ? (
                <MediaTab
                  event={event}
                  canEditEvent={canEditEvent}
                  imageUrl={props.imageUrl}
                  posterUploading={props.posterUploading}
                  brochureUploading={props.brochureUploading}
                  attachmentUploading={props.attachmentUploading}
                  posterInputRef={posterInputRef}
                  brochureInputRef={brochureInputRef}
                  attachmentInputRef={attachmentInputRef}
                  onUploadPoster={props.onUploadPoster}
                  onUploadBrochure={props.onUploadBrochure}
                  onRemoveBrochure={props.onRemoveBrochure}
                  onUploadAttachment={props.onUploadAttachment}
                  onRemoveAttachment={props.onRemoveAttachment}
                  onDownload={handleDownloadEventFile}
                />
              ) : props.activeTab === "organizers" ? (
                <OrganizersTab event={event} canEditEvent={canEditEvent} onAddOrganizers={props.onAddOrganizers} />
              ) : props.activeTab === "form" ? (
                <LinkedFormTab form={props.selectedEventForm} onOpenFormContent={props.onOpenFormContent} />
              ) : props.activeTab === "checkin" ? (
                <EventCheckinTab eventId={event.id} isMobile={isMobile} />
              ) : props.activeTab === "flow" ? (
                <EventFlowTab eventId={event.id} canEdit={canEditEvent} isMobile={isMobile} />
              ) : props.activeTab === "tasks" ? (
                <EventTaskTab eventId={event.id} canEdit={canEditEvent} isMobile={isMobile} />
              ) : props.activeTab === "budget" ? (
                <EventBudgetTab eventId={event.id} eventName={event.event_name} canEdit={canEditEvent} isMobile={isMobile} />
              ) : props.activeTab === "agent" ? (
                <EventAgentTab eventId={event.id} canEdit={canEditEvent} isMobile={isMobile} onApplied={props.onRefresh} />
              ) : (
                <div style={detailGridStyle(isMobile)}>
                  <EditableFact label="活动名称" value={event.event_name || ""} editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ event_name: v })} />
                  <EditableFact label="类型" value={event.type || ""} editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ type: v })} />
                  <EditableFact label="开始时间" value={toDatetimeLocal(event.datetime)} kind="datetime" editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ datetime: v || null })} />
                  <EditableFact label="结束时间" value={toDatetimeLocal(event.end_datetime)} kind="datetime" editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ end_datetime: v || null })} />
                  <EditableFact label="地点" value={event.location || ""} editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ location: v })} />
                  <EditableFact label="对象" value={event.target || ""} editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ target: v })} />
                  <EditableFact label="活动说明" value={event.purpose || ""} kind="textarea" editable={canEditEvent} onSave={(v) => props.onUpdateEvent({ purpose: v })} />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {createOpen ? (
        <div style={modalOverlayStyle} onClick={() => !props.creating && setCreateOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={publicHeadStyle}>
              <h4 style={panelTitleStyle}>新建活动</h4>
              <button type="button" style={btnStyle} disabled={props.creating} onClick={() => setCreateOpen(false)}>
                关闭
              </button>
            </div>
            {createError ? <div style={errorStyle}>{createError}</div> : null}
            <form style={createGridStyle} onSubmit={(e) => void handleCreateSubmit(e)}>
              <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                <span style={factLabelStyle}>活动名称</span>
                <input required style={factInputStyle} value={draft.event_name} onChange={(e) => setDraft((p) => ({ ...p, event_name: e.target.value }))} />
              </label>
              <label style={fieldStyle}>
                <span style={factLabelStyle}>开始时间</span>
                <input
                  required
                  type="datetime-local"
                  style={factInputStyle}
                  value={draft.datetime}
                  onChange={(e) => setDraft((p) => ({ ...p, datetime: e.target.value, end_datetime: addHoursToDatetimeLocal(e.target.value, 5) }))}
                />
              </label>
              <label style={fieldStyle}>
                <span style={factLabelStyle}>结束时间</span>
                <input type="datetime-local" style={factInputStyle} value={draft.end_datetime} onChange={(e) => setDraft((p) => ({ ...p, end_datetime: e.target.value }))} />
              </label>
              <label style={fieldStyle}>
                <span style={factLabelStyle}>地点</span>
                <input style={factInputStyle} value={draft.location} onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))} />
              </label>
              <label style={fieldStyle}>
                <span style={factLabelStyle}>类型</span>
                <input list="event-type-options" style={factInputStyle} value={draft.type} onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value }))} />
              </label>
              <label style={fieldStyle}>
                <span style={factLabelStyle}>对象</span>
                <input style={factInputStyle} value={draft.target} onChange={(e) => setDraft((p) => ({ ...p, target: e.target.value }))} />
              </label>
              <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                <span style={factLabelStyle}>活动说明</span>
                <textarea style={{ ...factInputStyle, minHeight: "120px", resize: "vertical" }} value={draft.purpose} onChange={(e) => setDraft((p) => ({ ...p, purpose: e.target.value }))} />
              </label>
              <div style={modalFooterStyle}>
                <button type="button" style={btnStyle} disabled={props.creating} onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button type="submit" style={primaryButtonStyle} disabled={props.creating}>
                  {props.creating ? "创建中…" : "创建活动"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MediaTab({
  event,
  canEditEvent,
  imageUrl,
  posterUploading,
  brochureUploading,
  attachmentUploading,
  posterInputRef,
  brochureInputRef,
  attachmentInputRef,
  onUploadPoster,
  onUploadBrochure,
  onRemoveBrochure,
  onUploadAttachment,
  onRemoveAttachment,
  onDownload,
}: {
  event: EventRecord;
  canEditEvent: boolean;
  imageUrl: string | null;
  posterUploading: boolean;
  brochureUploading: boolean;
  attachmentUploading: boolean;
  posterInputRef: RefObject<HTMLInputElement | null>;
  brochureInputRef: RefObject<HTMLInputElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  onUploadPoster: (file: File) => void;
  onUploadBrochure: (file: File) => void;
  onRemoveBrochure: () => void;
  onUploadAttachment: (files: File[]) => void;
  onRemoveAttachment: (fileId: number) => void;
  onDownload: (filePath: string, fileName?: string | null, mimeType?: string | null) => void;
}) {
  return (
    <div style={sectionBodyStyle}>
      {/* Poster */}
      <div style={posterCardStyle}>
        <div style={posterPreviewWrapStyle}>
          {imageUrl ? (
            <CachedImage src={imageUrl} cacheKey={`event-poster:${event.id}:${event.event_image?.id || "x"}`} alt="活动海报" style={posterPreviewStyle} />
          ) : (
            <div style={posterPlaceholderStyle}>
              <i className="fa-solid fa-image" aria-hidden="true" />
            </div>
          )}
        </div>
        <div style={attachmentMetaWrapStyle}>
          <div style={attachmentTitleStyle}>活动海报 / 封面</div>
          <div style={attachmentSubtitleStyle}>
            {event.event_image?.id ? `当前封面来自活动 album，图片 ID #${event.event_image.id}` : "上传图片后会自动进入活动 album，并切换为当前 event_image。"}
          </div>
          <div style={attachmentActionRowStyle}>
            {imageUrl ? (
              <button type="button" style={btnStyle} onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}>
                查看海报
              </button>
            ) : null}
            {canEditEvent ? (
              <>
                <button type="button" style={btnStyle} disabled={posterUploading} onClick={() => posterInputRef.current?.click()}>
                  {posterUploading ? "上传中…" : event.event_image?.id ? "替换海报" : "上传海报"}
                </button>
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/*,.heic,.heif"
                  style={hiddenInputStyle}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUploadPoster(file);
                    e.target.value = "";
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Brochure */}
      <div style={attachmentCardStyle}>
        <div style={attachmentMetaWrapStyle}>
          <div style={attachmentTitleStyle}>{event.brochure_name || "未上传简章"}</div>
          <div style={attachmentSubtitleStyle}>
            {event.brochure_path ? event.brochure_mime || "点击预览 / 下载" : "支持 PDF / PPT / PPTX / XLS / XLSX / DOC / DOCX"}
          </div>
        </div>
        <div style={attachmentActionRowStyle}>
          {event.brochure_path ? (
            <button
              type="button"
              style={btnStyle}
              onClick={() =>
                openBrochurePreviewModal({
                  file_name: event.brochure_name || undefined,
                  file_path: event.brochure_path || "",
                  mime_type: event.brochure_mime || undefined,
                })
              }
            >
              预览
            </button>
          ) : null}
          {event.brochure_path ? (
            <button type="button" style={btnStyle} onClick={() => onDownload(event.brochure_path || "", event.brochure_name, event.brochure_mime)}>
              下载
            </button>
          ) : null}
          {canEditEvent ? (
            <>
              <button type="button" style={btnStyle} disabled={brochureUploading} onClick={() => brochureInputRef.current?.click()}>
                {brochureUploading ? "上传中…" : event.brochure_path ? "替换文件" : "上传文件"}
              </button>
              {event.brochure_path ? (
                <button type="button" style={dangerButtonStyle} disabled={brochureUploading} onClick={onRemoveBrochure}>
                  移除
                </button>
              ) : null}
              <input
                ref={brochureInputRef}
                type="file"
                accept=".pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.dox"
                style={hiddenInputStyle}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadBrochure(file);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Attachments */}
      <div style={sectionTitleStyle}>活动附件</div>
      <div style={attachmentCardStyle}>
        <div style={attachmentMetaWrapStyle}>
          <div style={attachmentTitleStyle}>每个活动可上传多个附件</div>
          <div style={attachmentSubtitleStyle}>可用来放流程单、报名表、海报原档、赞助资料等</div>
        </div>
        <div style={attachmentActionRowStyle}>
          {canEditEvent ? (
            <>
              <button type="button" style={btnStyle} disabled={attachmentUploading} onClick={() => attachmentInputRef.current?.click()}>
                {attachmentUploading ? "上传中…" : "新增附件"}
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                style={hiddenInputStyle}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) onUploadAttachment(files);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
        </div>
      </div>
      {(event.event_files || []).length ? (
        event.event_files!.map((file) => (
          <div key={file.id} style={attachmentCardStyle}>
            <div style={attachmentMetaWrapStyle}>
              <div style={attachmentTitleStyle}>{file.file_name || `附件 #${file.id}`}</div>
              <div style={attachmentSubtitleStyle}>
                {file.mime_type || "未知类型"}
                {file.user_name ? ` · 上传者 ${file.user_name}` : ""}
                {file.created_at ? ` · ${file.created_at.replace("T", " ").slice(0, 16)}` : ""}
              </div>
            </div>
            <div style={attachmentActionRowStyle}>
              <button type="button" style={btnStyle} onClick={() => openPreviewModal({ file_name: file.file_name, file_path: file.file_path, mime_type: file.mime_type || undefined })}>
                预览
              </button>
              <button type="button" style={btnStyle} onClick={() => onDownload(file.file_path, file.file_name, file.mime_type)}>
                下载
              </button>
              {canEditEvent ? (
                <button type="button" style={dangerButtonStyle} onClick={() => onRemoveAttachment(file.id)}>
                  删除
                </button>
              ) : null}
            </div>
          </div>
        ))
      ) : (
        <div style={emptyInlineStyle}>还没有活动附件。</div>
      )}
    </div>
  );
}

function OrganizersTab({ event, canEditEvent, onAddOrganizers }: { event: EventRecord; canEditEvent: boolean; onAddOrganizers: () => void }) {
  return (
    <div style={sectionBodyStyle}>
      <div style={memberToolbarStyle}>
        <div style={sectionTitleStyle}>筹备团队</div>
        {canEditEvent ? (
          <button type="button" style={primaryButtonStyle} onClick={onAddOrganizers}>
            添加筹备团队
          </button>
        ) : null}
      </div>
      <div style={organizerRowStyle}>
        {(event.organizers || []).length ? (
          event.organizers!.map((user) => (
            <div key={user.id} style={organizerCardStyle}>
              <CachedImage
                src={`/api/user_control/get_profile_image/${user.id}`}
                cacheKey={`event-table-user:${user.id}`}
                resolveRelativeToApi
                alt={user.display_name || user.username || String(user.id)}
                style={organizerAvatarStyle}
              />
              <div style={organizerNameStyle}>{user.display_name || user.username || `#${user.id}`}</div>
            </div>
          ))
        ) : (
          <div style={emptyInlineStyle}>暂无筹备团队成员。</div>
        )}
      </div>
    </div>
  );
}

function LinkedFormTab({ form, onOpenFormContent }: { form: FormRecord | null; onOpenFormContent: (formId: number) => void }) {
  if (!form) {
    return <div style={emptyStyle}>当前活动还没有绑定对应的报名表格。</div>;
  }
  return (
    <div style={sectionBodyStyle}>
      <div style={attachmentCardStyle}>
        <div style={attachmentMetaWrapStyle}>
          <div style={attachmentTitleStyle}>{form.title || `报名表 #${form.id}`}</div>
          <div style={attachmentSubtitleStyle}>报名表格 ID #{form.id}</div>
        </div>
        <div style={attachmentActionRowStyle}>
          <button type="button" style={primaryButtonStyle} onClick={() => onOpenFormContent(form.id)}>
            查看报名内容
          </button>
          <button type="button" style={btnStyle} onClick={() => window.open(`/api/form/index/${form.id}`, "_blank", "noopener,noreferrer")}>
            打开报名表格
          </button>
        </div>
      </div>
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
  kind?: "text" | "date" | "datetime" | "textarea";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  function begin() {
    setDraft(value ?? "");
    setEditing(true);
  }
  function commit() {
    onSave(kind === "date" || kind === "datetime" ? draft.trim() : draft);
    setEditing(false);
  }
  const display = value && value.trim() ? (kind === "datetime" ? value.replace("T", " ") : value) : "未填写";
  return (
    <div style={{ ...factStyle, ...(kind === "textarea" ? { gridColumn: "1 / -1" } : {}) }}>
      <div style={factHeadStyle}>
        <div style={factLabelStyle}>{label}</div>
        {editable ? (
          editing ? (
            <div style={factIconGroupStyle}>
              <button type="button" style={factIconButtonStyle} title="保存" onClick={commit}>
                <i className="fa-solid fa-floppy-disk" />
              </button>
              <button type="button" style={factIconButtonStyle} title="取消" onClick={() => setEditing(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ) : (
            <button type="button" style={factIconButtonStyle} title="编辑" onClick={begin}>
              <i className="fa-solid fa-pen" />
            </button>
          )
        ) : null}
      </div>
      {editing ? (
        kind === "textarea" ? (
          <textarea style={{ ...factInputStyle, minHeight: "180px", resize: "vertical" }} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <input
            type={kind === "date" ? "date" : kind === "datetime" ? "datetime-local" : "text"}
            style={factInputStyle}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        )
      ) : (
        <div style={{ ...factValueStyle, ...(kind === "textarea" ? { whiteSpace: "pre-wrap" } : {}) }}>{display}</div>
      )}
    </div>
  );
}

function createDefaultDraft(): CreateDraft {
  const now = new Date();
  const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return {
    event_name: "",
    datetime: formatDatetimeLocal(now),
    end_datetime: formatDatetimeLocal(later),
    location: "",
    type: "",
    target: "",
    purpose: "",
  };
}

function formatDatetimeLocal(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function addHoursToDatetimeLocal(value: string, hoursToAdd: number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setHours(date.getHours() + hoursToAdd);
  return formatDatetimeLocal(date);
}

function toDatetimeLocal(value?: string | null): string {
  if (!value) return "";
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return formatDatetimeLocal(date);
}

function formatEventDateTime(value?: string | null): string {
  if (!value) return "—";
  return String(value).replace("T", " ").slice(0, 16);
}

const TABLE_CSS = `
.fw-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; }
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
`;

const pageStyle: CSSProperties = { display: "grid", gap: "16px" };
const panelStyle: CSSProperties = { borderRadius: "12px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", boxShadow: "0 1px 2px var(--x-color-shadow-soft)", overflow: "hidden" };

function toolbarStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: "12px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row", padding: "16px 18px", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)" };
}
function headerStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: "12px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row", padding: "16px 18px", borderBottom: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-alt)" };
}
const headerLeftStyle: CSSProperties = { display: "flex", gap: "12px", alignItems: "flex-start" };
function headerRightStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", width: isMobile ? "100%" : undefined };
}

const eyebrowStyle: CSSProperties = { fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const panelTitleStyle: CSSProperties = { margin: "2px 0", fontSize: "18px", fontWeight: 800 };
const mutedStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

function filterRowStyle(isMobile: boolean): CSSProperties {
  return { display: "flex", gap: "8px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row", padding: "12px 14px 0" };
}
const searchInputStyle: CSSProperties = { flex: "1 1 220px", minHeight: "34px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };
const selectStyle: CSSProperties = { minHeight: "34px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: "13px", boxSizing: "border-box" };

const tabBarWrapStyle: CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--x-color-line-soft)", overflowX: "auto" };
const tabBarStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const tabStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px", borderRadius: "8px", border: "1px solid transparent", background: "transparent", color: "var(--x-color-ink-muted)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const tabActiveStyle: CSSProperties = { ...tabStyle, border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-panel)", color: "var(--x-color-accent-strong)", boxShadow: "0 1px 2px var(--x-color-shadow-soft)" };

const btnStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 600, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const primaryButtonStyle: CSSProperties = { padding: "9px 18px", borderRadius: "8px", border: "1px solid var(--x-color-accent-strong)", background: "var(--x-color-accent)", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer" };
const dangerButtonStyle: CSSProperties = { padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };

const errorStyle: CSSProperties = { margin: "0", padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", color: "var(--x-color-danger)", fontSize: "13px" };
const successStyle: CSSProperties = { margin: "0", padding: "10px 14px", borderRadius: "8px", background: "var(--x-color-success-soft)", border: "1px solid rgba(21,128,61,0.28)", color: "var(--x-color-success)", fontSize: "13px" };
const emptyStyle: CSSProperties = { margin: "16px", padding: "28px", borderRadius: "10px", border: "1px dashed var(--x-color-line)", textAlign: "center", color: "var(--x-color-ink-muted)" };
const emptyInlineStyle: CSSProperties = { padding: "12px 14px", borderRadius: "8px", border: "1px dashed var(--x-color-line)", color: "var(--x-color-ink-muted)", fontSize: "13px" };

const bodyStyle: CSSProperties = { padding: "16px 18px", display: "grid", gap: "14px" };
const sectionBodyStyle: CSSProperties = { display: "grid", gap: "10px" };
const sectionTitleStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };

const tableWrapStyle: CSSProperties = { width: "100%", overflowX: "auto" };
const cellStrongStyle: CSSProperties = { fontWeight: 700, lineHeight: 1.4 };
const cellSubStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", marginTop: "2px" };
const monoCellStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontSize: "12.5px", whiteSpace: "nowrap" };
const memberToolbarStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" };

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

const attachmentCardStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "10px 12px", borderRadius: "10px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)" };
const attachmentMetaWrapStyle: CSSProperties = { minWidth: 0, display: "grid", gap: "3px" };
const attachmentTitleStyle: CSSProperties = { fontWeight: 700, color: "var(--x-color-ink)", wordBreak: "break-word" };
const attachmentSubtitleStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", wordBreak: "break-word" };
const attachmentActionRowStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };

const posterCardStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px, 200px) minmax(0, 1fr)", gap: "12px", alignItems: "start", padding: "12px", borderRadius: "10px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)" };
const posterPreviewWrapStyle: CSSProperties = { width: "100%", aspectRatio: "4 / 3", overflow: "hidden", borderRadius: "8px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const posterPreviewStyle: CSSProperties = { width: "100%", height: "100%", display: "block", objectFit: "cover" };
const posterPlaceholderStyle: CSSProperties = { width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)", fontSize: "28px" };

const organizerRowStyle: CSSProperties = { display: "flex", gap: "10px", flexWrap: "wrap" };
const organizerCardStyle: CSSProperties = { display: "grid", justifyItems: "center", gap: "6px", padding: "10px 12px", borderRadius: "10px", background: "var(--x-color-panel-alt)", border: "1px solid var(--x-color-line-soft)", minWidth: "96px" };
const organizerAvatarStyle: CSSProperties = { width: "48px", height: "48px", borderRadius: "50%", objectFit: "cover", border: "2px solid var(--x-color-panel)" };
const organizerNameStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink)", textAlign: "center" };

const hiddenInputStyle: CSSProperties = { display: "none" };

const modalOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", background: "rgba(15, 23, 42, 0.55)" };
const modalStyle: CSSProperties = { width: "min(720px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "18px", borderRadius: "14px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", boxShadow: "0 24px 60px var(--x-color-shadow)", display: "grid", gap: "12px" };
const createGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" };
const modalFooterStyle: CSSProperties = { gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" };
const publicHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" };
