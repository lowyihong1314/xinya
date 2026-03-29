import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

export type ExtraFieldDraft = {
  label: string;
  field_type: string;
  options?: string[] | null;
  order?: number | null;
};

export function ExtraFieldEditor({
  initialValue,
  buttonLabel,
  onSave,
  onDelete,
  readOnly = false,
}: {
  initialValue?: ExtraFieldDraft;
  buttonLabel: string;
  onSave: (payload: ExtraFieldDraft) => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<ExtraFieldDraft>(
    initialValue || {
      label: "",
      field_type: "text",
      options: null,
      order: null,
    },
  );

  const showOptions = draft.field_type === "select";
  const optionItems = useMemo(() => (Array.isArray(draft.options) ? draft.options : []), [draft.options]);

  return (
    <div style={editorCardStyle}>
      <div style={editorGridStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>显示名称</span>
          <input
            style={inputStyle}
            value={draft.label}
            placeholder="label"
            disabled={readOnly}
            onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>输入方式</span>
          <select
            style={inputStyle}
            value={draft.field_type}
            disabled={readOnly}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                field_type: event.target.value,
                options: event.target.value === "select" ? prev.options : null,
              }))
            }
          >
            <option value="text">单行文字</option>
            <option value="textarea">多行文字</option>
            <option value="select">下拉选择</option>
            <option value="number">数字</option>
            <option value="date">日期</option>
            <option value="checkbox">勾选</option>
          </select>
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>排序</span>
          <input
            style={inputStyle}
            type="number"
            value={draft.order == null ? "" : String(draft.order)}
            placeholder="0"
            disabled={readOnly}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                order: event.target.value === "" ? null : Number(event.target.value),
              }))
            }
          />
        </label>
      </div>

      {showOptions ? (
        <div style={fieldStyle}>
          <div style={optionsHeaderStyle}>
            <span style={labelStyle}>下拉选项</span>
            <button
              type="button"
              style={ghostButtonStyle}
              disabled={readOnly}
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  options: [...(Array.isArray(prev.options) ? prev.options : []), ""],
                }))
              }
            >
              添加选项
            </button>
          </div>

          {!optionItems.length ? <div style={hintStyle}>还没有选项，点击“添加选项”开始配置。</div> : null}

          <div style={optionsListStyle}>
            {optionItems.map((option, index) => (
              <div key={index} style={optionRowStyle}>
                <input
                  style={inputStyle}
                  value={option}
                  placeholder={`选项 ${index + 1}`}
                  disabled={readOnly}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      options: updateOptionAt(prev.options, index, event.target.value),
                    }))
                  }
                />
                <button
                  type="button"
                  style={deleteButtonStyle}
                  disabled={readOnly}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      options: removeOptionAt(prev.options, index),
                    }))
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={actionsStyle}>
        {readOnly ? (
          <div style={hintStyle}>只读</div>
        ) : (
          <>
            <button type="button" style={saveButtonStyle} onClick={() => onSave(draft)}>
              {buttonLabel}
            </button>
            {onDelete ? (
              <button type="button" style={deleteButtonStyle} onClick={onDelete}>
                删除
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function updateOptionAt(options: string[] | null | undefined, index: number, value: string) {
  const next = Array.isArray(options) ? [...options] : [];
  next[index] = value;
  return normalizeOptions(next);
}

function removeOptionAt(options: string[] | null | undefined, index: number) {
  const next = Array.isArray(options) ? options.filter((_, itemIndex) => itemIndex !== index) : [];
  return normalizeOptions(next);
}

function normalizeOptions(options: string[]) {
  const next = options.map((item) => item.trim());
  return next.length ? next : null;
}

const editorCardStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "14px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-strong)",
};

const editorGridStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const labelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};

const saveButtonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const deleteButtonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const optionsHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const optionsListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const optionRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "10px",
  alignItems: "center",
};

const hintStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px dashed var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  background: "var(--x-color-panel)",
};
