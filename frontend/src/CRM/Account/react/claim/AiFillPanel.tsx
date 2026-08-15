import { useRef, type CSSProperties } from "react";

import { buttonGhostStyle, chipStyle } from "./claimStyles";
import { confidencePercent } from "./readBillFill";

export type AiFillOutcome = {
  filledLabels: string[];
  lineCount: number;
  total: number;
  confidence?: unknown;
  model: "auto" | "byteplus";
} | null;

/**
 * AI 读单面板：选文件 → 一键识别 → 看清楚 AI 填了什么 → 不满意可撤销。
 * 新建申请与批量申请弹窗共用（批量那边 hideUpload，文件由卡片自己带）。
 */
export function AiFillPanel({
  files,
  onFilesAdd,
  onFileRemove,
  parsing,
  canParse,
  onParse,
  outcome,
  error,
  onUndo,
  hideUpload = false,
  note,
}: {
  files: File[];
  onFilesAdd?: (files: File[]) => void;
  onFileRemove?: (index: number) => void;
  parsing: boolean;
  canParse: boolean;
  onParse: (model: "auto" | "byteplus") => void;
  outcome: AiFillOutcome;
  error?: string | null;
  onUndo?: () => void;
  hideUpload?: boolean;
  note?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const percent = outcome ? confidencePercent(outcome.confidence) : null;

  return (
    <div className="claim-ai-panel" style={panelStyle}>
      <div style={headStyle}>
        <span style={badgeStyle}>
          <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
          AI 读单
        </span>
        <span style={headHintStyle}>{note || "上传收据照片或 PDF，AI 自动填日期、商家与逐项明细"}</span>
      </div>

      {hideUpload ? null : (
        <>
          <button
            type="button"
            className="claim-ai-panel__drop"
            style={dropZoneStyle}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = Array.from(event.dataTransfer?.files || []);
              if (dropped.length) onFilesAdd?.(dropped);
            }}
          >
            <i className="fa-regular fa-image" aria-hidden="true" style={dropIconStyle} />
            <span style={dropTitleStyle}>点击选择，或把收据拖进来</span>
            <span style={dropHintStyle}>支持 JPG / PNG / PDF，可多选</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              const picked = Array.from(event.target.files || []);
              if (picked.length) onFilesAdd?.(picked);
              event.target.value = "";
            }}
          />
        </>
      )}

      {files.length ? (
        <div style={fileRowStyle}>
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`} style={fileChipStyle}>
              <i
                className={file.type === "application/pdf" ? "fa-regular fa-file-pdf" : "fa-regular fa-image"}
                aria-hidden="true"
              />
              <span style={fileNameStyle}>{file.name}</span>
              <span style={fileSizeStyle}>{Math.round(file.size / 1024)} KB</span>
              {onFileRemove ? (
                <button type="button" style={fileRemoveStyle} title="移除" onClick={() => onFileRemove(index)}>
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : hideUpload ? null : (
        <span style={emptyHintStyle}>还没有选择文件</span>
      )}

      <div style={actionRowStyle}>
        <button
          type="button"
          style={{ ...aiButtonStyle, ...(canParse && !parsing ? {} : disabledLook) }}
          disabled={!canParse || parsing}
          onClick={() => onParse("auto")}
        >
          <i className={parsing ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-wand-magic-sparkles"} aria-hidden="true" />
          {parsing ? "识别中…" : "AI 智能填写"}
        </button>
        <button
          type="button"
          style={{ ...proButtonStyle, ...(canParse && !parsing ? {} : disabledLook) }}
          disabled={!canParse || parsing}
          title="用 BytePlus 模型再读一次，收据较花时更准"
          onClick={() => onParse("byteplus")}
        >
          PRO 精读
        </button>
        {outcome && onUndo ? (
          <button type="button" style={buttonGhostStyle} onClick={onUndo}>
            撤销这次填写
          </button>
        ) : null}
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      {outcome ? (
        <div className="claim-ai-panel__result" style={resultStyle}>
          <div style={resultHeadStyle}>
            <span style={resultTitleStyle}>
              已填写 {outcome.filledLabels.length} 项
              {outcome.model === "byteplus" ? <span style={modelChipStyle}>PRO</span> : null}
            </span>
            {percent != null ? (
              <span style={confidenceWrapStyle}>
                <span style={confidenceTrackStyle}>
                  <span style={{ ...confidenceBarStyle, width: `${percent}%` }} />
                </span>
                <span style={confidenceTextStyle}>信心 {percent}%</span>
              </span>
            ) : null}
          </div>
          <div style={resultChipRowStyle}>
            {outcome.filledLabels.map((label) => (
              <span key={label} style={{ ...chipStyle, background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }}>
                {label}
              </span>
            ))}
          </div>
          <span style={resultHintStyle}>
            明细 {outcome.lineCount} 行 · 收据总额 RM {outcome.total.toFixed(2)} — 请核对金额后再提交
          </span>
        </div>
      ) : null}
    </div>
  );
}

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-accent-soft)",
};
const headStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "3px 10px",
  borderRadius: "999px",
  background: "var(--x-color-accent)",
  color: "#fff",
  fontSize: "12px",
  fontWeight: 800,
};
const headHintStyle: CSSProperties = { fontSize: "11.5px", color: "var(--x-color-ink-muted)" };
const dropZoneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "3px",
  padding: "16px 12px",
  borderRadius: "10px",
  border: "1px dashed var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  cursor: "pointer",
};
const dropIconStyle: CSSProperties = { fontSize: "20px", color: "var(--x-color-accent-strong)" };
const dropTitleStyle: CSSProperties = { fontSize: "13px", fontWeight: 800, color: "var(--x-color-ink)" };
const dropHintStyle: CSSProperties = { fontSize: "11px", color: "var(--x-color-ink-muted)" };
const fileRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "6px" };
const fileChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  maxWidth: "100%",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  fontSize: "12px",
};
const fileNameStyle: CSSProperties = { maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const fileSizeStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "11px" };
const fileRemoveStyle: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--x-color-danger)",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: 1,
  padding: 0,
};
const emptyHintStyle: CSSProperties = { fontSize: "11.5px", color: "var(--x-color-ink-muted)" };
const actionRowStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" };
const aiButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "9px 16px",
  borderRadius: "9px",
  border: "none",
  background: "var(--x-color-accent)",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 800,
  cursor: "pointer",
};
const proButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "9px 14px",
  borderRadius: "9px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)",
  fontSize: "12.5px",
  fontWeight: 800,
  cursor: "pointer",
};
const disabledLook: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };
const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
  fontSize: "12.5px",
};
const resultStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "10px",
  borderRadius: "10px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
};
const resultHeadStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" };
const resultTitleStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 800 };
const modelChipStyle: CSSProperties = {
  padding: "1px 7px",
  borderRadius: "999px",
  background: "var(--x-color-accent-tint)",
  color: "var(--x-color-accent-strong)",
  fontSize: "10.5px",
  fontWeight: 800,
};
const confidenceWrapStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px" };
const confidenceTrackStyle: CSSProperties = {
  width: 84,
  height: 6,
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  overflow: "hidden",
};
const confidenceBarStyle: CSSProperties = { display: "block", height: "100%", background: "var(--x-color-accent)" };
const confidenceTextStyle: CSSProperties = { fontSize: "11px", color: "var(--x-color-ink-muted)" };
const resultChipRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "5px" };
const resultHintStyle: CSSProperties = { fontSize: "11.5px", color: "var(--x-color-ink-muted)" };
