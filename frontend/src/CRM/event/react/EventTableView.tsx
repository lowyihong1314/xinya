import { useRef, useState, type CSSProperties, type FormEvent } from "react";

import { openBrochurePreviewModal } from "../../../event/shared/brochurePreview";
import type { EventCreatePayload, EventMutationPayload, EventRecord } from "./types";

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
  events: EventRecord[];
  totalResults: number;
  selectedEvent: EventRecord | null;
  selectedEventId: number | null;
  query: string;
  page: number;
  totalPages: number;
  loading: boolean;
  saving: boolean;
  creating: boolean;
  brochureUploading: boolean;
  toast: Toast;
  realtimeEnabled: boolean;
  imageUrl: string | null;
  onQueryChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelectEvent: (eventId: number) => void;
  onRefresh: () => void;
  onToggleRealtime: (value: boolean) => void;
  onAddOrganizers: () => void;
  onCreateEvent: (payload: EventCreatePayload) => Promise<boolean>;
  onUpdateEvent: (patch: EventMutationPayload) => void;
  onUploadBrochure: (file: File) => void;
  onRemoveBrochure: () => void;
  onDeleteEvent: () => void;
}) {
  const isMobile = props.isMobile ?? false;
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(() => createDefaultDraft());
  const [createError, setCreateError] = useState<string | null>(null);
  const brochureInputRef = useRef<HTMLInputElement | null>(null);

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

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Event Table</div>
          <h3 style={titleStyle}>活动管理</h3>
        </div>
        <div style={headerActionsStyle}>
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
          <label style={toggleStyle}>
            <input
              type="checkbox"
              checked={props.realtimeEnabled}
              onChange={(event) => props.onToggleRealtime(event.target.checked)}
            />
            <span>预留实时更新</span>
          </label>
          <button type="button" style={secondaryButtonStyle} onClick={props.onRefresh}>
            刷新
          </button>
        </div>
      </header>

      {props.toast ? (
        <div style={props.toast.type === "success" ? successBannerStyle : errorBannerStyle}>
          {props.toast.text}
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
          <input
            placeholder="搜索活动名称 / 地点 / 类型 / 对象 / 筹备团队"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            style={searchStyle}
          />
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
                <div style={eventNavTitleStyle(active)}>{event.event_name || `活动 #${event.id}`}</div>
                <div style={eventNavMetaStyle}>{event.datetime ? event.datetime.split("T")[0] : "-"}</div>
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
                  <img
                    src={props.imageUrl || "https://via.placeholder.com/180x180?text=No+Image"}
                    alt={props.selectedEvent.event_name || "event"}
                    style={heroImageStyle}
                  />
                </div>
                <div style={heroCopyStyle}>
                  <div style={heroTopRowStyle}>
                    <div style={sectionEyebrowStyle}>Current Event</div>
                    <button type="button" style={ghostDangerStyle} onClick={props.onDeleteEvent}>
                      删除活动
                    </button>
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
                  <div style={inlineNoteStyle}>{props.saving ? "保存中…" : "修改会立即同步到后端"}</div>
                </div>
                <div style={formGridStyle(isMobile)}>
                  <Field
                    label="活动名称"
                    value={props.selectedEvent.event_name || ""}
                    onCommit={(value) => props.onUpdateEvent({ event_name: value })}
                  />
                  <Field
                    label="开始时间"
                    value={props.selectedEvent.datetime || ""}
                    onCommit={(value) => props.onUpdateEvent({ datetime: value })}
                    type="datetime-local"
                  />
                  <Field
                    label="结束时间"
                    value={props.selectedEvent.end_datetime || ""}
                    onCommit={(value) => props.onUpdateEvent({ end_datetime: value || undefined })}
                    type="datetime-local"
                  />
                  <Field
                    label="地点"
                    value={props.selectedEvent.location || ""}
                    onCommit={(value) => props.onUpdateEvent({ location: value })}
                  />
                  <Field
                    label="类型"
                    value={props.selectedEvent.type || ""}
                    onCommit={(value) => props.onUpdateEvent({ type: value })}
                  />
                  <Field
                    label="对象"
                    value={props.selectedEvent.target || ""}
                    onCommit={(value) => props.onUpdateEvent({ target: value })}
                  />
                  <Field
                    label="活动说明"
                    value={props.selectedEvent.purpose || ""}
                    onCommit={(value) => props.onUpdateEvent({ purpose: value })}
                    textarea
                    wide
                  />
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
                            onClick={() => window.open(`/media_file/${props.selectedEvent.brochure_path}`, "_blank", "noopener,noreferrer")}
                          >
                            下载
                          </button>
                        ) : null}
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
                      </div>
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
                  <button type="button" style={primaryButtonStyle} onClick={props.onAddOrganizers}>
                    添加筹备团队
                  </button>
                </div>
                <div style={organizerRowStyle}>
                  {(props.selectedEvent.organizers || []).length ? (
                    props.selectedEvent.organizers!.map((user) => (
                      <div key={user.id} style={organizerCardStyle}>
                        <img
                          src={`/api/user_control/get_profile_image/${user.id}`}
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

function Field({
  label,
  value,
  onCommit,
  type,
  textarea,
  wide,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  textarea?: boolean;
  wide?: boolean;
  placeholder?: string;
}) {
  return (
    <label style={wide ? wideFieldStyle : fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {textarea ? (
        <textarea
          rows={5}
          style={textareaStyle}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(event) => onCommit(event.target.value)}
        />
      ) : (
        <input
          type={type}
          style={inputStyle}
          defaultValue={value}
          placeholder={placeholder}
          onBlur={(event) => onCommit(event.target.value)}
        />
      )}
    </label>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const titleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "30px",
  lineHeight: 1.1,
  color: "var(--x-color-ink)",
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
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
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostDangerStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

const successBannerStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};

const errorBannerStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "rgba(15, 23, 42, 0.48)",
  zIndex: 1200,
};

function modalCardStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "100%" : "780px",
    maxHeight: "min(88vh, 920px)",
    overflow: "auto",
    padding: "22px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.26)",
  };
}

function layoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(280px, 340px) minmax(0, 1fr)",
    gap: "20px",
    alignItems: "start",
  };
}

function sidebarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "12px",
    position: isMobile ? "static" : "sticky",
    top: isMobile ? undefined : "84px",
  };
}

const searchStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  padding: "12px 14px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxSizing: "border-box",
  fontSize: "14px",
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
    padding: "16px",
    borderRadius: "var(--x-radius-md)",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: active
      ? "linear-gradient(145deg, var(--x-color-accent-tint-strong), var(--x-color-info-tint))"
      : "var(--x-color-panel-strong)",
    boxShadow: active ? "0 18px 34px var(--x-color-shadow-medium)" : "0 10px 24px var(--x-color-shadow-soft)",
    textAlign: "left",
    cursor: "pointer",
  };
}

const eventNavTitleStyle = (active: boolean): CSSProperties => ({
  fontSize: "16px",
  fontWeight: 700,
  color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
});

const eventNavMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const paginationStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  marginTop: "4px",
};

const paginationButtonStyle: CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};

const contentStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "180px minmax(0, 1fr)",
    gap: "18px",
    padding: isMobile ? "16px" : "20px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  };
}

const heroImageWrapStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
};

const heroImageStyle: CSSProperties = {
  width: "180px",
  height: "180px",
  borderRadius: "18px",
  objectFit: "cover",
  background: "var(--x-color-panel-alt)",
};

const heroCopyStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const heroTopRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  flexWrap: "wrap",
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const sectionTitleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "24px",
  color: "var(--x-color-ink)",
};

const inlineNoteStyle: CSSProperties = {
  fontSize: "14px",
  color: "var(--x-color-ink-muted)",
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  marginTop: "8px",
};

const chipStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const panelStyle: CSSProperties = {
  padding: "22px",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 14px 34px var(--x-color-shadow-soft)",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  flexWrap: "wrap",
  paddingBottom: "14px",
  marginBottom: "16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

function formGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "16px",
  };
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const wideFieldStyle: CSSProperties = {
  ...fieldStyle,
  gridColumn: "1 / -1",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  padding: "12px 14px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  boxSizing: "border-box",
  fontSize: "14px",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical",
};

const hiddenInputStyle: CSSProperties = {
  display: "none",
};

const attachmentCardStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  flexWrap: "wrap",
  minHeight: "64px",
  padding: "14px 16px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line-soft)",
  background: "linear-gradient(180deg, var(--x-color-panel-alt), var(--x-color-panel))",
};

const attachmentMetaWrapStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const attachmentTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

const attachmentSubtitleStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.5,
};

const attachmentActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
};

const modalActionsStyle: CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  flexWrap: "wrap",
  paddingTop: "8px",
};

const organizerRowStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};

const organizerCardStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: "8px",
};

const organizerAvatarStyle: CSSProperties = {
  width: "52px",
  height: "52px",
  borderRadius: "50%",
  objectFit: "cover",
  border: "2px solid var(--x-color-panel)",
  boxShadow: "0 8px 18px var(--x-color-shadow-soft)",
};

const organizerNameStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

const placeholderStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};
