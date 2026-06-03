import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { saveEvent, setEventPoster, uploadEventBrochure } from "../../event/shared/api";
import type { AlbumFile, EventDetailRecord } from "../../event/shared/types";
import { openBrochurePreviewModal } from "../../event/shared/brochurePreview";
import { FIXED_EVENT_TYPES } from "../../event/shared/eventTypes";
import { downloadUrlOrShare } from "../../js/browserActions";

type Props = {
  detail: EventDetailRecord;
  onClose: () => void;
  onSaved: (next: EventDetailRecord) => void;
};

type PosterThumbProps = {
  file: AlbumFile;
  selected: boolean;
  onSelect: (fileId: number) => void;
};

export function EditEventModal({ detail, onClose, onSaved }: Props) {
  useEnsureDesignTokens();
  const { isMobile } = useUserState();
  const posterFiles = detail.album_files || [];
  const posterPageSize = 15;

  const [form, setForm] = useState(() => ({
    event_name: detail.event_name || "",
    location: detail.location || "",
    purpose: detail.purpose || "",
    type: detail.type || "",
    target: detail.target || "",
    datetime: toLocalInputValue(detail.datetime),
    end_datetime: toLocalInputValue(detail.end_datetime),
  }));
  const [selectedPosterId, setSelectedPosterId] = useState<number | null>(detail.event_image?.id ?? null);
  const [posterPage, setPosterPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [uploadingBrochure, setUploadingBrochure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const brochureInputRef = useRef<HTMLInputElement | null>(null);
  const posterTotalPages = Math.max(1, Math.ceil(posterFiles.length / posterPageSize));
  const posterPageItems = posterFiles.slice((posterPage - 1) * posterPageSize, posterPage * posterPageSize);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setPosterPage(1);
  }, [detail.id]);

  useEffect(() => {
    setPosterPage((prev) => Math.min(prev, posterTotalPages));
  }, [posterTotalPages]);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const payload = await saveEvent({
        event_id: detail.id,
        event_name: form.event_name,
        location: form.location,
        purpose: form.purpose,
        type: form.type,
        target: form.target,
        datetime: form.datetime || undefined,
        end_datetime: form.end_datetime || null,
      });

      if (selectedPosterId && selectedPosterId !== detail.event_image?.id) {
        await setEventPoster(detail.id, selectedPosterId);
      }

      onSaved({
        ...detail,
        ...(payload.data || {}),
        event_name: form.event_name,
        location: form.location,
        purpose: form.purpose,
        type: form.type,
        target: form.target,
        datetime: form.datetime ? new Date(form.datetime).toISOString() : detail.datetime,
        end_datetime: form.end_datetime ? new Date(form.end_datetime).toISOString() : null,
        event_image: selectedPosterId ? { id: selectedPosterId } : payload.data?.event_image || detail.event_image,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleBrochureUpload(file: File) {
    setUploadingBrochure(true);
    setError(null);
    try {
      const payload = await uploadEventBrochure(detail.id, file);
      onSaved({
        ...detail,
        ...(payload.data || {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "简章上传失败");
    } finally {
      setUploadingBrochure(false);
    }
  }

  async function handleBrochureRemove() {
    setUploadingBrochure(true);
    setError(null);
    try {
      const payload = await saveEvent({
        event_id: detail.id,
        brochure_path: null,
      });
      onSaved({
        ...detail,
        ...(payload.data || {}),
        brochure_path: null,
        brochure_name: null,
        brochure_mime: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "简章移除失败");
    } finally {
      setUploadingBrochure(false);
    }
  }

  async function handleBrochureDownload() {
    if (!detail.brochure_path) {
      return;
    }
    setError(null);
    const url = `/media_file/${detail.brochure_path}`;
    const filename = detail.brochure_name || detail.brochure_path.split("/").pop() || "event-brochure";
    try {
      await downloadUrlOrShare(url, filename, {
        isMobile,
        title: detail.event_name || filename,
        text: filename,
        fallbackUrl: `${window.location.origin}${url}`,
        mimeType: detail.brochure_mime || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败");
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <datalist id="album-event-type-options">
          {FIXED_EVENT_TYPES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Event Editor</div>
            <h2 style={titleStyle}>编辑活动资料</h2>
          </div>
          <button type="button" style={closeButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <div style={sectionStyle}>
          <div style={posterHeaderStyle}>
            <div style={sectionTitleStyle}>活动海报</div>
            {posterFiles.length ? (
              <div style={posterPagerMetaStyle}>
                {posterFiles.length} 张 · 第 {posterPage} / {posterTotalPages} 页
              </div>
            ) : null}
          </div>
          {!posterFiles.length ? <div style={hintStyle}>当前活动还没有照片可选作海报</div> : null}
          <div style={posterGridStyle}>
            {posterPageItems.map((file) => (
              <PosterThumb
                key={file.id}
                file={file}
                selected={selectedPosterId === file.id}
                onSelect={setSelectedPosterId}
              />
            ))}
          </div>
          {posterTotalPages > 1 ? (
            <div style={posterPagerStyle}>
              <button
                type="button"
                style={posterPagerButtonStyle}
                disabled={posterPage <= 1}
                onClick={() => setPosterPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                style={posterPagerButtonStyle}
                disabled={posterPage >= posterTotalPages}
                onClick={() => setPosterPage((prev) => Math.min(posterTotalPages, prev + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}
        </div>

        <div style={formGridStyle}>
          <Field label="活动名称" value={form.event_name} onChange={(value) => setForm((prev) => ({ ...prev, event_name: value }))} />
          <Field label="地点" value={form.location} onChange={(value) => setForm((prev) => ({ ...prev, location: value }))} />
          <Field label="类型" value={form.type} list="album-event-type-options" onChange={(value) => setForm((prev) => ({ ...prev, type: value }))} />
          <Field label="对象" value={form.target} onChange={(value) => setForm((prev) => ({ ...prev, target: value }))} />
          <Field
            label="开始时间"
            value={form.datetime}
            type="datetime-local"
            onChange={(value) => setForm((prev) => ({ ...prev, datetime: value }))}
          />
          <Field
            label="结束时间"
            value={form.end_datetime}
            type="datetime-local"
            onChange={(value) => setForm((prev) => ({ ...prev, end_datetime: value }))}
          />
          <Field
            label="活动说明"
            value={form.purpose}
            onChange={(value) => setForm((prev) => ({ ...prev, purpose: value }))}
            textarea
            wide
          />
          <div style={wideFieldStyle}>
            <span style={labelStyle}>简章文件</span>
            <div style={brochureCardStyle}>
              <div style={brochureMetaStyle}>
                <div style={brochureNameStyle}>{detail.brochure_name || "未上传简章"}</div>
                <div style={brochureHintStyle}>
                  {detail.brochure_path
                    ? detail.brochure_mime || "点击预览或下载"
                    : "支持 PDF / PPT / PPTX / XLS / XLSX / DOC / DOCX / DOX"}
                </div>
              </div>
              <div style={brochureActionStyle}>
                {detail.brochure_path ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() =>
                      openBrochurePreviewModal({
                        file_name: detail.brochure_name || undefined,
                        file_path: detail.brochure_path || "",
                        mime_type: detail.brochure_mime || undefined,
                      })
                    }
                  >
                    预览
                  </button>
                ) : null}
                {detail.brochure_path ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void handleBrochureDownload()}
                  >
                    下载
                  </button>
                ) : null}
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  disabled={uploadingBrochure}
                  onClick={() => brochureInputRef.current?.click()}
                >
                  {uploadingBrochure ? "上传中…" : detail.brochure_path ? "替换文件" : "上传文件"}
                </button>
                {detail.brochure_path ? (
                  <button type="button" style={closeButtonStyle} disabled={uploadingBrochure} onClick={() => void handleBrochureRemove()}>
                    移除
                  </button>
                ) : null}
                <input
                  ref={brochureInputRef}
                  type="file"
                  accept=".pdf,.ppt,.pptx,.xls,.xlsx,.doc,.docx,.dox"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleBrochureUpload(file);
                    }
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={footerStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            取消
          </button>
          <button type="button" style={primaryButtonStyle} disabled={saving} onClick={() => void handleSubmit()}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PosterThumb({ file, selected, onSelect }: PosterThumbProps) {
  return (
    <button type="button" style={posterButtonStyle(selected)} onClick={() => onSelect(file.id)}>
      <CacheMediaPlayer
        fileId={file.id}
        fileType={file.file_type}
        alt={file.user_display_name || `poster-${file.id}`}
        style={posterImageStyle}
        retryAttempts={6}
        retryDelayMs={1500}
      />
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  wide,
  type = "text",
  list,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  wide?: boolean;
  type?: string;
  list?: string;
}) {
  return (
    <label style={wide ? wideFieldStyle : fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {textarea ? (
        <textarea rows={4} style={textareaStyle} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input type={type} list={list} style={inputStyle} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function toLocalInputValue(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(9, 16, 29, 0.64)",
  display: "grid",
  placeItems: "center",
  zIndex: 5000,
  padding: "24px",
};

const modalStyle: CSSProperties = {
  width: "min(880px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  padding: "24px",
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel-strong))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 24px 54px var(--x-color-shadow-strong)",
  display: "grid",
  gap: "18px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const titleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "28px",
  color: "var(--x-color-ink)",
};

const closeButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};

const sectionStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const posterHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  flexWrap: "wrap",
};

const posterPagerMetaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const hintStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

const posterGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: "12px",
};

const posterPagerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};

const posterPagerButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 700,
};

const posterButtonStyle = (selected: boolean): CSSProperties => ({
  padding: "0",
  borderRadius: "14px",
  overflow: "hidden",
  border: selected ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  boxShadow: selected ? "0 0 0 4px var(--x-color-accent-tint-strong)" : "none",
  cursor: "pointer",
});

const posterImageStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  objectFit: "cover",
  display: "block",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "14px",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const wideFieldStyle: CSSProperties = {
  ...fieldStyle,
  gridColumn: "1 / -1",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  padding: "12px 14px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical",
};

const brochureCardStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  flexWrap: "wrap",
  padding: "14px 16px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line-soft)",
  background: "linear-gradient(180deg, var(--x-color-panel-alt), var(--x-color-panel))",
};

const brochureMetaStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const brochureNameStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

const brochureHintStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const brochureActionStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
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

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-sm)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};
