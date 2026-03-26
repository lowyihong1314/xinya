import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import heic2any from "heic2any";

import { uploadFeeImage } from "./api";

export type FeeDraft = {
  id?: number | string | null;
  category: string;
  amount: string | number;
  age_range_from?: string | number | null;
  age_range_to?: string | number | null;
  description?: string | null;
  image_path?: string | null;
};

type FeePanelProps = {
  formId?: number;
  fees: FeeDraft[];
  onAdd: (payload: FeeDraft) => void;
  onEdit: (feeId: number | string, payload: FeeDraft) => void;
  onDelete: (feeId: number | string) => void;
  linkHref?: string;
  linkLabel?: string;
  addButtonLabel?: string;
  saveButtonLabel?: string;
  emptyText?: string;
  showCategory?: boolean;
  enableImageUpload?: boolean;
  imageLabel?: string;
  categoryLabel?: string;
  categoryPlaceholder?: string;
  descriptionPlaceholder?: string;
};

type FeeInlineEditorProps = {
  initialValue?: FeeDraft;
  buttonLabel: string;
  onSave: (payload: FeeDraft) => void;
  onDelete?: () => void;
  resetOnSave?: boolean;
  showCategory?: boolean;
  enableImageUpload?: boolean;
  imageLabel?: string;
  categoryLabel?: string;
  categoryPlaceholder?: string;
  descriptionPlaceholder?: string;
};

const EMPTY_FEE_DRAFT: FeeDraft = {
  category: "",
  amount: "",
  age_range_from: "",
  age_range_to: "",
  description: "",
  image_path: "",
};

function normalizeInitialValue(initialValue?: FeeDraft): FeeDraft {
  return {
    id: initialValue?.id ?? null,
    category: String(initialValue?.category || ""),
    amount: String(initialValue?.amount || ""),
    age_range_from: String(initialValue?.age_range_from || ""),
    age_range_to: String(initialValue?.age_range_to || ""),
    description: String(initialValue?.description || ""),
    image_path: String(initialValue?.image_path || ""),
  };
}

async function normalizeFeeImageFile(file: File) {
  if (!/\.hei(c|f)$/i.test(file.name) && !/image\/hei(c|f)/i.test(file.type)) {
    return file;
  }

  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.9,
  });
  const normalizedBlob = Array.isArray(converted) ? converted[0] : converted;
  return new File([normalizedBlob as BlobPart], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
    type: "image/jpeg",
  });
}

export function buildAgeFeeLabel(ageFrom?: string | number | null, ageTo?: string | number | null) {
  const normalizedFrom = String(ageFrom ?? "").trim();
  const normalizedTo = String(ageTo ?? "").trim();
  if (normalizedFrom && normalizedTo) return `${normalizedFrom}-${normalizedTo} 岁`;
  if (normalizedFrom) return `${normalizedFrom} 岁以上`;
  if (normalizedTo) return `${normalizedTo} 岁以下`;
  return "所有年龄";
}

export function summarizeFee(item: {
  category?: string | null;
  amount?: string | number | null;
  age_range_from?: string | number | null;
  age_range_to?: string | number | null;
}) {
  const category = String(item.category ?? "").trim();
  const amount = Number(item.amount || 0);
  const ageLabel = buildAgeFeeLabel(item.age_range_from, item.age_range_to);
  return `${category || ageLabel} · RM ${amount.toFixed(2)}`;
}

export function normalizeFeeDrafts(
  rawValue: unknown,
  options?: { fallbackImagePath?: string | null; fallbackCategory?: string | null },
): FeeDraft[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue.map((item) => {
    const rawId = (item as { id?: unknown })?.id;
    const ageFrom = String((item as { age_range_from?: unknown })?.age_range_from ?? "");
    const ageTo = String((item as { age_range_to?: unknown })?.age_range_to ?? "");
    const label = String((item as { label?: unknown })?.label ?? "");
    return {
      id: typeof rawId === "number" || typeof rawId === "string" ? rawId : null,
      category:
        String((item as { category?: unknown })?.category ?? "").trim() ||
        label.trim() ||
        options?.fallbackCategory ||
        buildAgeFeeLabel(ageFrom, ageTo),
      amount: String((item as { amount?: unknown })?.amount ?? ""),
      age_range_from: ageFrom,
      age_range_to: ageTo,
      description: String((item as { description?: unknown })?.description ?? ""),
      image_path:
        String((item as { image_path?: unknown })?.image_path ?? "").trim() ||
        String(options?.fallbackImagePath || ""),
    };
  });
}

export function FeePanel({
  formId,
  fees,
  onAdd,
  onEdit,
  onDelete,
  linkHref,
  linkLabel = "付款入口",
  addButtonLabel = "添加费用",
  saveButtonLabel = "保存",
  emptyText = "暂无费用配置",
  showCategory = true,
  enableImageUpload = true,
  imageLabel = "付款资料",
  categoryLabel = "类别",
  categoryPlaceholder = "例如：儿童 / 成人",
  descriptionPlaceholder = "收费说明",
}: FeePanelProps) {
  const resolvedLinkHref = linkHref || (formId ? `/api/form/pay_register/${formId}` : "");

  return (
    <div style={sectionBodyStyle}>
      {resolvedLinkHref ? (
        <div style={sectionInlineActionsStyle}>
          <a href={resolvedLinkHref} target="_blank" rel="noreferrer" style={smallLinkButtonStyle}>
            {linkLabel}
          </a>
        </div>
      ) : null}

      <FeeInlineEditor
        buttonLabel={addButtonLabel}
        resetOnSave
        onSave={(payload) => onAdd(payload)}
        showCategory={showCategory}
        enableImageUpload={enableImageUpload}
        imageLabel={imageLabel}
        categoryLabel={categoryLabel}
        categoryPlaceholder={categoryPlaceholder}
        descriptionPlaceholder={descriptionPlaceholder}
      />

      <div style={stackStyle}>
        {fees.length ? (
          fees.map((fee) => {
            const feeKey = fee.id;
            if (feeKey == null) {
              return null;
            }
            return (
              <FeeInlineEditor
                key={String(feeKey)}
                initialValue={fee}
                buttonLabel={saveButtonLabel}
                onSave={(payload) => onEdit(feeKey, payload)}
                onDelete={() => onDelete(feeKey)}
                showCategory={showCategory}
                enableImageUpload={enableImageUpload}
                imageLabel={imageLabel}
                categoryLabel={categoryLabel}
                categoryPlaceholder={categoryPlaceholder}
                descriptionPlaceholder={descriptionPlaceholder}
              />
            );
          })
        ) : (
          <div style={placeholderStyle}>{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function FeeInlineEditor({
  initialValue,
  buttonLabel,
  onSave,
  onDelete,
  resetOnSave = false,
  showCategory = true,
  enableImageUpload = true,
  imageLabel = "付款资料",
  categoryLabel = "类别",
  categoryPlaceholder = "例如：儿童 / 成人",
  descriptionPlaceholder = "收费说明",
}: FeeInlineEditorProps) {
  const [draft, setDraft] = useState<FeeDraft>(() => normalizeInitialValue(initialValue));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(normalizeInitialValue(initialValue));
  }, [
    initialValue?.id,
    initialValue?.category,
    initialValue?.amount,
    initialValue?.age_range_from,
    initialValue?.age_range_to,
    initialValue?.description,
    initialValue?.image_path,
  ]);

  async function handleFeeImageChange(file: File | null) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const normalizedFile = await normalizeFeeImageFile(file);
      const result = await uploadFeeImage(normalizedFile);
      setDraft((prev) => ({ ...prev, image_path: result.image_path || "" }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleSave() {
    onSave(draft);
    if (resetOnSave) {
      setDraft({ ...EMPTY_FEE_DRAFT });
    }
  }

  return (
    <div style={feeEditorCardStyle}>
      <div style={feeEditorGridStyle}>
        {showCategory ? (
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{categoryLabel}</span>
            <input
              style={compactInputStyle}
              value={draft.category}
              placeholder={categoryPlaceholder}
              onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}
            />
          </label>
        ) : null}

        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>金额</span>
          <input
            style={compactInputStyle}
            value={draft.amount}
            placeholder="金额"
            onChange={(event) => setDraft((prev) => ({ ...prev, amount: event.target.value }))}
          />
        </label>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>年龄起</span>
          <input
            style={compactInputStyle}
            value={draft.age_range_from || ""}
            placeholder="可空"
            onChange={(event) => setDraft((prev) => ({ ...prev, age_range_from: event.target.value }))}
          />
        </label>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>年龄止</span>
          <input
            style={compactInputStyle}
            value={draft.age_range_to || ""}
            placeholder="可空"
            onChange={(event) => setDraft((prev) => ({ ...prev, age_range_to: event.target.value }))}
          />
        </label>
      </div>

      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>说明</span>
        <textarea
          rows={3}
          style={feeTextareaStyle}
          value={draft.description || ""}
          placeholder={descriptionPlaceholder}
          onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
        />
      </label>

      {enableImageUpload ? (
        <div style={feeImageSectionStyle}>
          {uploadError ? <div style={errorBannerStyle}>{uploadError}</div> : null}
          <div style={feeImageControlStyle}>
            <span style={fieldLabelStyle}>{imageLabel}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/heic,image/heif,.png,.jpg,.jpeg,.heic,.heif"
              onChange={(event) => void handleFeeImageChange(event.target.files?.[0] || null)}
            />
            {uploading ? <span style={inlineNoteStyle}>上传中…</span> : null}
          </div>
          {draft.image_path ? (
            <a href={draft.image_path} target="_blank" rel="noreferrer" style={feeImagePreviewStyle}>
              <img src={draft.image_path} alt={imageLabel} style={feeImageStyle} />
            </a>
          ) : (
            <div style={feeImageEmptyStyle}>未上传图片</div>
          )}
        </div>
      ) : null}

      <div style={feeActionRowStyle}>
        <button type="button" style={smallSecondaryButtonStyle} onClick={handleSave}>
          {buttonLabel}
        </button>
        {onDelete ? (
          <button type="button" style={smallDangerButtonStyle} onClick={onDelete}>
            删除
          </button>
        ) : null}
      </div>
    </div>
  );
}

const sectionBodyStyle: CSSProperties = { display: "grid", gap: "12px" };
const sectionInlineActionsStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" };
const stackStyle: CSSProperties = { display: "grid", gap: "10px" };
const placeholderStyle: CSSProperties = { padding: "18px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink-muted)" };
const linkButtonStyle: CSSProperties = { padding: "12px 18px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer", textDecoration: "none" };
const smallLinkButtonStyle: CSSProperties = { ...linkButtonStyle, padding: "8px 12px", fontSize: "13px" };
const smallSecondaryButtonStyle: CSSProperties = { padding: "8px 12px", borderRadius: "999px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 700, cursor: "pointer", fontSize: "13px" };
const smallDangerButtonStyle: CSSProperties = { padding: "8px 12px", borderRadius: "999px", border: "1px solid var(--x-color-danger-border)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 700, cursor: "pointer", fontSize: "13px" };
const errorBannerStyle: CSSProperties = { padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
const inlineNoteStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "14px" };
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const fieldLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = { width: "100%", padding: "12px 14px", borderRadius: "12px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)", boxSizing: "border-box" };
const compactInputStyle: CSSProperties = { minWidth: "120px", padding: "10px 12px", borderRadius: "12px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)", color: "var(--x-color-ink)" };
const feeEditorCardStyle: CSSProperties = { display: "grid", gap: "14px", padding: "14px", borderRadius: "16px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel-strong)" };
const feeEditorGridStyle: CSSProperties = { display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" };
const feeTextareaStyle: CSSProperties = { ...inputStyle, minHeight: "88px", resize: "vertical" };
const feeImageSectionStyle: CSSProperties = { display: "grid", gap: "10px" };
const feeImageControlStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" };
const feeImagePreviewStyle: CSSProperties = { display: "inline-flex", width: "fit-content", textDecoration: "none" };
const feeImageStyle: CSSProperties = { display: "block", width: "100%", maxWidth: "220px", maxHeight: "160px", objectFit: "cover", borderRadius: "14px", border: "1px solid var(--x-color-line-soft)", background: "var(--x-color-panel)" };
const feeImageEmptyStyle: CSSProperties = { padding: "18px", borderRadius: "14px", border: "1px dashed var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", fontSize: "13px", background: "var(--x-color-panel)" };
const feeActionRowStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" };
