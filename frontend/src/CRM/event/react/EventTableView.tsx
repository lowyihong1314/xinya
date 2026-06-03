import { useRef, useState, type CSSProperties, type FormEvent } from "react";

import { CachedImage } from "../../../components/CachedMedia";
import { openPreviewModal } from "../../../js/attachment_preview";
import { downloadUrlOrShare } from "../../../js/browserActions";
import { show_alert } from "../../../js/show_alert";
import { openBrochurePreviewModal } from "../../../event/shared/brochurePreview";
import { buildEventTypeChoices } from "../../../event/shared/eventTypes";
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

export function EventTableView(props: {
  isMobile?: boolean;
  canEditEvent?: boolean;
  events: EventRecord[];
  totalResults: number;
  selectedEvent: EventRecord | null;
  selectedEventId: number | null;
  selectedEventForm: FormRecord | null;
  query: string;
  selectedType: string;
  eventTypeOptions: Array<{ value: string; label: string }>;
  page: number;
  totalPages: number;
  loading: boolean;
  saving: boolean;
  creating: boolean;
  posterUploading: boolean;
  brochureUploading: boolean;
  attachmentUploading: boolean;
  toast: Toast;
  realtimeEnabled: boolean;
  imageUrl: string | null;
  onQueryChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelectEvent: (eventId: number) => void;
  onRefresh: () => void;
  onToggleRealtime: (value: boolean) => void;
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
    props.eventTypeOptions
      .map((option) => option.value)
      .filter((value) => !String(value).startsWith("__")),
  );

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

  return (
    <div style={pageStyle}>
      <datalist id="event-type-options">
        {eventTypeChoices.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Event Table</div>
          <h3 style={titleStyle}>创建活动</h3>
        </div>
        <div style={headerActionsStyle}>
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
      </header>

      {props.toast ? (
        <div style={props.toast.type === "success" ? successBannerStyle : errorBannerStyle}>
          {props.toast.text}
        </div>
      ) : null}

      {!canEditEvent ? (
        <div style={errorBannerStyle}>
          当前账号只有活动读取权限。新增、修改、删除、上传和团队维护都需要 <code>event_edit</code>。
        </div>
      ) : null}

      {createOpen ? (
        <div style={modalOverlayStyle} onClick={() => !props.creating && setCreateOpen(false)}>
          <div style={modalCardStyle(isMobile)} onClick={(event) => event.stopPropagation()}>
            <div style={panelHeaderStyle}>
              <div>
                <div style={sectionEyebrowStyle}>Create Event</div>
                <h4 style={sectionTitleStyle}>新建活动</h4>
              </div>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={props.creating}
                onClick={() => setCreateOpen(false)}
              >
                关闭
              </button>
            </div>
            {createError ? <div style={errorBannerStyle}>{createError}</div> : null}
            <form style={formGridStyle(isMobile)} onSubmit={(event) => void handleCreateSubmit(event)}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>活动名称</span>
                <input
                  required
                  style={inputStyle}
                  value={draft.event_name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, event_name: event.target.value }))}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>开始时间</span>
                <input
                  required
                  type="datetime-local"
                  style={inputStyle}
                  value={draft.datetime}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      datetime: event.target.value,
                      end_datetime: addHoursToDatetimeLocal(event.target.value, 5),
                    }))
                  }
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>结束时间</span>
                <input
                  type="datetime-local"
                  style={inputStyle}
                  value={draft.end_datetime}
                  onChange={(event) => setDraft((prev) => ({ ...prev, end_datetime: event.target.value }))}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>地点</span>
                <input
                  style={inputStyle}
                  value={draft.location}
                  onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>类型</span>
                <input
                  list="event-type-options"
                  style={inputStyle}
                  value={draft.type}
                  onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value }))}
                />
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>对象</span>
                <input
                  style={inputStyle}
                  value={draft.target}
                  onChange={(event) => setDraft((prev) => ({ ...prev, target: event.target.value }))}
                />
              </label>
              <label style={wideFieldStyle}>
                <span style={fieldLabelStyle}>活动说明</span>
                <textarea
                  rows={5}
                  style={textareaStyle}
                  value={draft.purpose}
                  onChange={(event) => setDraft((prev) => ({ ...prev, purpose: event.target.value }))}
                />
              </label>
              <div style={modalActionsStyle}>
                <div style={inlineNoteStyle}>创建成功后会自动刷新列表并选中该活动</div>
                <button type="submit" style={primaryButtonStyle} disabled={props.creating}>
                  {props.creating ? "创建中…" : "创建活动"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div style={layoutStyle(isMobile)}>
        <aside style={sidebarStyle(isMobile)}>
          <div style={searchControlsStyle(isMobile)}>
            <input
              placeholder="搜索活动名称 / 地点 / 对象 / 筹备团队"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              style={searchStyle}
            />
            <select
              value={props.selectedType}
              onChange={(event) => props.onTypeChange(event.target.value)}
              style={searchSelectStyle}
            >
              {props.eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {!props.loading ? (
            <div style={resultsMetaStyle}>
              <span>搜索结果 {props.totalResults}</span>
              <span>
                第 {props.page} / {props.totalPages} 页
              </span>
            </div>
          ) : null}
          {props.loading ? <div style={placeholderStyle}>载入活动中…</div> : null}
          {!props.loading && !props.events.length ? <div style={placeholderStyle}>暂无活动</div> : null}
          {props.events.map((event) => {
            const active = props.selectedEventId === event.id;
            const organizersText = (event.organizers || [])
              .map((organizer) => organizer.display_name || organizer.username || organizer.id)
              .join(", ");
            return (
              <button
                key={event.id}
                type="button"
                style={eventNavCardStyle(active)}
                onClick={() => props.onSelectEvent(event.id)}
              >
                <div style={eventNavMetaStyle}>Event ID #{event.id}</div>
                <div style={eventNavTitleStyle(active)}>{event.event_name || `活动 #${event.id}`}</div>
                <div style={eventNavMetaStyle}>{formatEventNavDate(event.datetime)}</div>
                <div style={eventNavMetaStyle}>
                  {event.location || "-"} · {event.type || "-"}
                </div>
                {organizersText ? <div style={eventNavMetaStyle}>团队: {organizersText}</div> : null}
              </button>
            );
          })}
          {!props.loading && props.totalResults > 6 ? (
            <div style={paginationStyle}>
              <button
                type="button"
                style={paginationButtonStyle}
                disabled={props.page <= 1}
                onClick={() => props.onPageChange(props.page - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                style={paginationButtonStyle}
                disabled={props.page >= props.totalPages}
                onClick={() => props.onPageChange(props.page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </aside>

        <section style={contentStyle}>
          {!props.selectedEvent ? <div style={placeholderStyle}>选择一个活动开始编辑</div> : null}
          {props.selectedEvent ? (
            <>
              <section style={heroStyle(isMobile)}>
                <div style={heroImageWrapStyle}>
                  <CachedImage
                    src={props.imageUrl || "https://via.placeholder.com/180x180?text=No+Image"}
                    cacheKey={props.selectedEventId != null ? `event-table-image:${props.selectedEventId}` : undefined}
                    alt={props.selectedEvent.event_name || "event"}
                    style={heroImageStyle}
                  />
                </div>
                <div style={heroCopyStyle}>
                  <div style={heroTopRowStyle}>
                    <div style={sectionEyebrowStyle}>Current Event</div>
                    {canEditEvent ? (
                      <button type="button" style={ghostDangerStyle} onClick={props.onDeleteEvent}>
                        删除活动
                      </button>
                    ) : null}
                  </div>
                  <h4 style={sectionTitleStyle}>{props.selectedEvent.event_name || `活动 #${props.selectedEvent.id}`}</h4>
                  <div style={inlineNoteStyle}>
                    {props.selectedEvent.datetime || "-"} → {props.selectedEvent.end_datetime || "-"}
                  </div>
                  <div style={chipRowStyle}>
                    <span style={chipStyle}>地点 {props.selectedEvent.location || "-"}</span>
                    <span style={chipStyle}>类型 {props.selectedEvent.type || "-"}</span>
                    <span style={chipStyle}>对象 {props.selectedEvent.target || "-"}</span>
                    <span style={chipStyle}>
                      创建者 {props.selectedEvent.display_name || props.selectedEvent.username || "-"}
                    </span>
                  </div>
                </div>
              </section>

              <section key={props.selectedEvent.id} style={panelStyle}>
                <div style={panelHeaderStyle}>
                  <div>
                    <div style={sectionEyebrowStyle}>Editor</div>
                    <h4 style={sectionTitleStyle}>活动资料</h4>
                  </div>
                  <div style={inlineNoteStyle}>
                    {canEditEvent ? (props.saving ? "自动保存中…" : "修改会自动保存") : "当前为只读模式"}
                  </div>
                </div>
                <div style={formGridStyle(isMobile)}>
                  <Field
                    label="活动名称"
                    value={props.selectedEvent.event_name || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ event_name: value })}
                  />
                  <Field
                    label="开始时间"
                    value={props.selectedEvent.datetime || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ datetime: value })}
                    type="datetime-local"
                  />
                  <Field
                    label="结束时间"
                    value={props.selectedEvent.end_datetime || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ end_datetime: value || undefined })}
                    type="datetime-local"
                  />
                  <Field
                    label="地点"
                    value={props.selectedEvent.location || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ location: value })}
                  />
                  <Field
                    label="类型"
                    value={props.selectedEvent.type || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ type: value })}
                    list="event-type-options"
                  />
                  <Field
                    label="对象"
                    value={props.selectedEvent.target || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ target: value })}
                  />
                  <Field
                    label="活动说明"
                    value={props.selectedEvent.purpose || ""}
                    readOnly={!canEditEvent}
                    onChange={(value) => props.onUpdateEvent({ purpose: value })}
                    textarea
                    wide
                  />
                  <label style={wideFieldStyle}>
                    <span style={fieldLabelStyle}>活动海报</span>
                    <div style={attachmentCardStyle}>
                      <div style={attachmentMetaWrapStyle}>
                        <div style={attachmentTitleStyle}>
                          {props.selectedEvent.event_image?.id ? "当前活动海报已设置" : "未设置活动海报"}
                        </div>
                        <div style={attachmentSubtitleStyle}>
                          {props.selectedEvent.event_image?.id
                            ? `当前封面来自活动 album，图片 ID #${props.selectedEvent.event_image.id}`
                            : "上传图片后会自动进入活动 album，并切换为当前 event_image。"}
                        </div>
                      </div>
                      <div style={attachmentActionRowStyle}>
                        {props.imageUrl ? (
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() => window.open(props.imageUrl || "", "_blank", "noopener,noreferrer")}
                          >
                            查看当前海报
                          </button>
                        ) : null}
                        {canEditEvent ? (
                          <>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              disabled={props.posterUploading}
                              onClick={() => posterInputRef.current?.click()}
                            >
                              {props.posterUploading
                                ? "上传中…"
                                : props.selectedEvent.event_image?.id
                                  ? "替换海报"
                                  : "上传海报"}
                            </button>
                            <input
                              ref={posterInputRef}
                              type="file"
                              accept="image/*,.heic,.heif"
                              style={hiddenInputStyle}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  props.onUploadPoster(file);
                                }
                                event.target.value = "";
                              }}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>
                  </label>
                  <label style={wideFieldStyle}>
                    <span style={fieldLabelStyle}>报名表格</span>
                    <div style={attachmentCardStyle}>
                      <div style={attachmentMetaWrapStyle}>
                        <div style={attachmentTitleStyle}>
                          {props.selectedEventForm?.title || "该活动没有报名表格"}
                        </div>
                        <div style={attachmentSubtitleStyle}>
                          {props.selectedEventForm
                            ? `报名表格 ID #${props.selectedEventForm.id}`
                            : "当前活动还没有绑定对应的报名表格。"}
                        </div>
                      </div>
                      <div style={attachmentActionRowStyle}>
                        {props.selectedEventForm ? (
                          <>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => props.onOpenFormContent(props.selectedEventForm!.id)}
                            >
                              查看报名内容
                            </button>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => window.open(`/api/form/index/${props.selectedEventForm?.id}`, "_blank", "noopener,noreferrer")}
                            >
                              打开报名表格
                            </button>
                          </>
                        ) : (
                          <span style={inlineNoteStyle}>该活动没有报名表格</span>
                        )}
                      </div>
                    </div>
                  </label>
                  <label style={wideFieldStyle}>
                    <span style={fieldLabelStyle}>简章文件</span>
                    <div style={attachmentCardStyle}>
                      <div style={attachmentMetaWrapStyle}>
                        <div style={attachmentTitleStyle}>
                          {props.selectedEvent.brochure_name || "未上传简章"}
                        </div>
                        <div style={attachmentSubtitleStyle}>
                          {props.selectedEvent.brochure_path
                            ? props.selectedEvent.brochure_mime || "点击预览 / 下载"
                            : "支持 PDF / PPT / PPTX / XLS / XLSX / DOC / DOCX"}
                        </div>
                      </div>
                      <div style={attachmentActionRowStyle}>
                        {props.selectedEvent.brochure_path ? (
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() =>
                              openBrochurePreviewModal({
                                file_name: props.selectedEvent.brochure_name || undefined,
                                file_path: props.selectedEvent.brochure_path || "",
                                mime_type: props.selectedEvent.brochure_mime || undefined,
                              })
                            }
                          >
                            预览
                          </button>
                        ) : null}
                        {props.selectedEvent.brochure_path ? (
                          <button
                            type="button"
                            style={secondaryButtonStyle}
                            onClick={() =>
                              void handleDownloadEventFile(
                                props.selectedEvent!.brochure_path || "",
                                props.selectedEvent!.brochure_name,
                                props.selectedEvent!.brochure_mime,
                              )
                            }
                          >
                            下载
                          </button>
                        ) : null}
                        {canEditEvent ? (
                          <>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              disabled={props.brochureUploading}
                              onClick={() => brochureInputRef.current?.click()}
                            >
                              {props.brochureUploading ? "上传中…" : props.selectedEvent.brochure_path ? "替换文件" : "上传文件"}
                            </button>
                            {props.selectedEvent.brochure_path ? (
                              <button
                                type="button"
                                style={ghostDangerStyle}
                                disabled={props.brochureUploading}
                                onClick={props.onRemoveBrochure}
                              >
                                移除
                              </button>
                            ) : null}
                            <input
                              ref={brochureInputRef}
                              type="file"
                              accept=".pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.dox"
                              style={hiddenInputStyle}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                  props.onUploadBrochure(file);
                                }
                                event.target.value = "";
                              }}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>
                  </label>

                  <label style={wideFieldStyle}>
                    <span style={fieldLabelStyle}>活动附件</span>
                    <div style={attachmentListStyle}>
                      <div style={attachmentCardStyle}>
                        <div style={attachmentMetaWrapStyle}>
                          <div style={attachmentTitleStyle}>每个活动可上传多个附件</div>
                          <div style={attachmentSubtitleStyle}>可用来放流程单、报名表、海报原档、赞助资料等</div>
                        </div>
                        <div style={attachmentActionRowStyle}>
                          {canEditEvent ? (
                            <>
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                disabled={props.attachmentUploading}
                                onClick={() => attachmentInputRef.current?.click()}
                              >
                                {props.attachmentUploading ? "上传中…" : "新增附件"}
                              </button>
                              <input
                                ref={attachmentInputRef}
                                type="file"
                                multiple
                                style={hiddenInputStyle}
                                onChange={(event) => {
                                  const files = Array.from(event.target.files || []);
                                  if (files.length) {
                                    props.onUploadAttachment(files);
                                  }
                                  event.target.value = "";
                                }}
                              />
                            </>
                          ) : null}
                        </div>
                      </div>

                      {(props.selectedEvent.event_files || []).length ? (
                        props.selectedEvent.event_files!.map((file) => (
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
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                onClick={() =>
                                  openPreviewModal({
                                    file_name: file.file_name,
                                    file_path: file.file_path,
                                    mime_type: file.mime_type || undefined,
                                  })
                                }
                              >
                                预览
                              </button>
                              <button
                                type="button"
                                style={secondaryButtonStyle}
                                onClick={() => void handleDownloadEventFile(file.file_path, file.file_name, file.mime_type)}
                              >
                                下载
                              </button>
                              {canEditEvent ? (
                                <button
                                  type="button"
                                  style={ghostDangerStyle}
                                  onClick={() => props.onRemoveAttachment(file.id)}
                                >
                                  删除
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={placeholderStyle}>还没有活动附件</div>
                      )}
                    </div>
                  </label>
                </div>
              </section>

              <section style={panelStyle}>
                <div style={panelHeaderStyle}>
                  <div>
                    <div style={sectionEyebrowStyle}>Organizers</div>
                    <h4 style={sectionTitleStyle}>筹备团队</h4>
                  </div>
                  {canEditEvent ? (
                    <button type="button" style={primaryButtonStyle} onClick={props.onAddOrganizers}>
                      添加筹备团队
                    </button>
                  ) : null}
                </div>
                <div style={organizerRowStyle}>
                  {(props.selectedEvent.organizers || []).length ? (
                    props.selectedEvent.organizers!.map((user) => (
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
                    <div style={placeholderStyle}>暂无筹备团队成员</div>
                  )}
                </div>
              </section>
            </>
          ) : null}
        </section>
      </div>
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
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setHours(date.getHours() + hoursToAdd);
  return formatDatetimeLocal(date);
}

function formatEventNavDate(datetime?: string | null) {
  if (!datetime) {
    return "-";
  }

  const rawDate = String(datetime).trim().split(/[T ]/)[0];
  const parsed = new Date(`${rawDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return rawDate || "-";
  }

  const weekday = parsed.toLocaleDateString("zh-CN", { weekday: "long" });
  return `${rawDate} ${weekday}`;
}

function Field({
  label,
  value,
  onChange,
  type,
  textarea,
  wide,
  placeholder,
  readOnly = false,
  list,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  textarea?: boolean;
  wide?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  list?: string;
}) {
  return (
    <label style={wide ? wideFieldStyle : fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {textarea ? (
        <textarea
          rows={5}
          style={textareaStyle}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(event) => {
            if (!readOnly) {
              onChange(event.target.value);
            }
          }}
        />
      ) : (
        <input
          type={type}
          list={list}
          style={inputStyle}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(event) => {
            if (!readOnly) {
              onChange(event.target.value);
            }
          }}
        />
      )}
    </label>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
  paddingBottom: "8px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const titleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "20px",
  lineHeight: 1.1,
  color: "var(--x-color-ink)",
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  alignItems: "center",
  flexWrap: "wrap",
};

const toggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  color: "var(--x-color-ink-muted)",
  fontSize: "14px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "6px",
  border: "none",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

const ghostDangerStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "13px",
};

const successBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};

const errorBannerStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "6px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: "12px",
  background: "rgba(15, 23, 42, 0.48)",
  zIndex: 1200,
};

function modalCardStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "100%" : "780px",
    maxHeight: "min(88vh, 920px)",
    overflow: "auto",
    padding: "12px",
    borderRadius: "8px",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
  };
}

function layoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 300px) minmax(0, 1fr)",
    gap: "10px",
    alignItems: "start",
  };
}

function sidebarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "6px",
    position: isMobile ? "static" : "sticky",
    top: isMobile ? undefined : "68px",
  };
}

const searchStyle: CSSProperties = {
  minHeight: "32px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxSizing: "border-box",
  fontSize: "13px",
};

const searchControlsStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 140px",
  gap: "6px",
  alignItems: "stretch",
});

const searchSelectStyle: CSSProperties = {
  minHeight: "32px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxSizing: "border-box",
  fontSize: "13px",
};

const resultsMetaStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  marginBottom: "2px",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

function eventNavCardStyle(active: boolean): CSSProperties {
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

const eventNavTitleStyle = (active: boolean): CSSProperties => ({
  fontSize: "13px",
  fontWeight: 700,
  color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
});

const eventNavMetaStyle: CSSProperties = {
  marginTop: "3px",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

const paginationStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  marginTop: "2px",
};

const paginationButtonStyle: CSSProperties = {
  flex: 1,
  padding: "7px 8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontSize: "12px",
};

const contentStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "112px minmax(0, 1fr)",
    gap: "10px",
    padding: isMobile ? "10px" : "10px",
    borderRadius: "8px",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "none",
  };
}

const heroImageWrapStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
};

const heroImageStyle: CSSProperties = {
  width: "112px",
  height: "112px",
  borderRadius: "6px",
  objectFit: "cover",
  background: "var(--x-color-panel-alt)",
};

const heroCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const heroTopRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  flexWrap: "wrap",
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const sectionTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "18px",
  color: "var(--x-color-ink)",
};

const inlineNoteStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
  marginTop: "4px",
};

const chipStyle: CSSProperties = {
  padding: "4px 7px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

const panelStyle: CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "none",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
  paddingBottom: "8px",
  marginBottom: "10px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

function formGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  };
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const wideFieldStyle: CSSProperties = {
  ...fieldStyle,
  gridColumn: "1 / -1",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "32px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  boxSizing: "border-box",
  fontSize: "13px",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "84px",
  resize: "vertical",
};

const hiddenInputStyle: CSSProperties = {
  display: "none",
};

const attachmentListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const attachmentCardStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
  minHeight: "44px",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

const attachmentMetaWrapStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const attachmentTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

const attachmentSubtitleStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.35,
};

const attachmentActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
  alignItems: "center",
};

const modalActionsStyle: CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
  paddingTop: "4px",
};

const organizerRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const organizerCardStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: "4px",
};

const organizerAvatarStyle: CSSProperties = {
  width: "38px",
  height: "38px",
  borderRadius: "50%",
  objectFit: "cover",
  border: "1px solid var(--x-color-panel)",
  boxShadow: "none",
};

const organizerNameStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

const placeholderStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "6px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};
