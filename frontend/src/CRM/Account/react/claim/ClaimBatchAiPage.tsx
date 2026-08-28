import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";

import { useUserState } from "../../../../app/UserState";
import { render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import {
  buttonGhostStyle,
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  chipStyle,
  fieldLabelStyle,
  fieldStyle,
  footerActionsStyle,
  formGridStyle,
  inputStyle,
  placeholderStyle,
  panelHeaderStyle,
  panelTitleStyle,
  textareaStyle,
  wideFieldStyle,
} from "./claimStyles";
import { readClaimBill, submitClaim, type ReadBillModel } from "./api";
import { ClaimFormSections, type CreateState } from "./ClaimCreateForm";
import { buildClaimFormData, buildInitialCreateState } from "./submitCreate";
import { buildReadBillFill, confidencePercent } from "./readBillFill";
import { hasFilledLine, lineItemsTotal, validateLineItems } from "./lineItems";
import type { AiFillOutcome } from "./AiFillPanel";
import type { AccountUser, ReadBillData, ReadBillUploadResponse } from "./types";
import { showEventPicker, type EventPickerRecord } from "../../../shared/showEventPicker";

type ClaimBatchAiPageProps = {
  onBack: () => void;
  onSubmitted?: (result: { count: number; claimIds: number[] }) => void | Promise<void>;
};

type BatchAiImageItem = {
  id: string;
  file: File;
  previewUrl: string;
  parsing: boolean;
  parseError: string;
  parseResult: ReadBillUploadResponse | null;
  // 和「新建申请」完全一样的表单状态，信息弹窗直接复用同一套输入布局
  draft: CreateState;
};

export function ClaimBatchAiPage({ onBack, onSubmitted }: ClaimBatchAiPageProps) {
  const { user, isMobile } = useUserState();
  const accountUser = (user as AccountUser | null) ?? null;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const [items, setItems] = useState<BatchAiImageItem[]>([]);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [infoItemId, setInfoItemId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventPickerRecord | null>(null);
  const [batchSubmitError, setBatchSubmitError] = useState("");
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState("");
  const [batchParsing, setBatchParsing] = useState(false);
  const previewItem = items.find((item) => item.id === previewItemId) ?? null;
  const infoItem = items.find((item) => item.id === infoItemId) ?? null;
  const infoOutcome: AiFillOutcome =
    infoItem?.parseResult?.data
      ? (() => {
          const fill = buildReadBillFill(infoItem.parseResult!.data as ReadBillData);
          return {
            filledLabels: fill.filledLabels,
            lineCount: fill.lineCount,
            total: fill.total,
            confidence: infoItem.parseResult!.meta?.confidence,
            model: "auto" as const,
          };
        })()
      : null;

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!previewItemId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewItemId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewItemId]);

  function handleChooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter(isSupportedReceiptFile);

    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];

    const nextItems = files.map((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.push(previewUrl);
      return {
        id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
        file,
        previewUrl,
        parsing: false,
        parseError: "",
        parseResult: null,
        draft: { ...buildInitialCreateState(accountUser), files: [file] },
      };
    });

    setItems(nextItems);
    setPreviewItemId(null);
    setInfoItemId(null);
    event.target.value = "";
  }

  function handleRemoveItem(itemId: string) {
    setItems((prev) => {
      const item = prev.find((current) => current.id === itemId);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== item.previewUrl);
      }
      return prev.filter((current) => current.id !== itemId);
    });
    setPreviewItemId((current) => (current === itemId ? null : current));
    setInfoItemId((current) => (current === itemId ? null : current));
  }

  async function handlePickEvent() {
    const event = await showEventPicker();
    if (event) {
      setSelectedEvent(event);
      setBatchSubmitError("");
    }
  }

  async function handleBatchSubmit() {
    if (batchSubmitting) {
      return;
    }

    if (!items.length) {
      setBatchSubmitError("请先选择文件");
      return;
    }

    if (!selectedEvent) {
      setBatchSubmitError("请先选择活动");
      return;
    }

    const missingItems = getMissingSubmitItems(items);
    if (missingItems.length) {
      setBatchSubmitError(
        missingItems
          .slice(0, 3)
          .map((item) => `文件 ${item.index + 1} 缺少${item.fields.join("、")}`)
          .join("；"),
      );
      return;
    }

    setBatchSubmitError("");
    setBatchSubmitting(true);
    setSubmitProgress("");
    let submittedCount = 0;
    try {
      const sign = await render_sign_modal(null);
      if (!sign?.strokes?.length) {
        setBatchSubmitError("请先签名");
        return;
      }

      const claimIds: number[] = [];
      for (const [index, item] of items.entries()) {
        setSubmitProgress(`提交中 ${index + 1}/${items.length}`);
        // 走和单张申请同一个 FormData 组装逻辑（含明细 line_items）
        const formData = buildClaimFormData(
          {
            ...item.draft,
            files: [item.file],
            selectedEvent: { id: selectedEvent.id, event_name: selectedEvent.event_name },
            signJsonData: { strokes: sign.strokes },
          },
          accountUser,
        );
        const result = await submitClaim(formData);
        const claimId = Number(result.data?.id || result.request_id || 0);
        submittedCount += 1;
        if (claimId > 0) {
          claimIds.push(claimId);
        }
      }

      items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      previewUrlsRef.current = [];
      setItems([]);
      setInfoItemId(null);
      setPreviewItemId(null);
      setSubmitProgress("");
      if (onSubmitted) {
        await onSubmitted({ count: items.length, claimIds });
      } else {
        onBack();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "批量提交失败";
      setBatchSubmitError(submittedCount ? `已提交 ${submittedCount}/${items.length}；${message}` : message);
    } finally {
      setBatchSubmitting(false);
      setSubmitProgress("");
    }
  }

  async function parseItem(
    item: BatchAiImageItem,
    index: number,
    model: ReadBillModel = "auto",
    options: { debug?: boolean } = {},
  ) {
    setItems((prev) =>
      prev.map((current) =>
        current.id === item.id ? { ...current, parsing: true, parseError: "", parseResult: null } : current,
      ),
    );

    try {
      const result = await readClaimBill(item.file, model, options);
      if (!result.data) {
        throw new Error("AI 没有返回识别结果");
      }

      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? {
                ...current,
                parsing: false,
                parseError: "",
                parseResult: result,
                draft: { ...current.draft, ...buildReadBillFill(result.data).patch },
              }
            : current,
        ),
      );
      console.log("batch-ai-parse-result", { index, fileName: item.file.name, result, selectedEvent });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 解析失败";
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id ? { ...current, parsing: false, parseError: message } : current,
        ),
      );
    }
  }

  async function handleParseItem(item: BatchAiImageItem, index: number) {
    await parseItem(item, index, "auto", { debug: true });
  }

  async function handleBatchParse() {
    if (batchParsing) {
      return;
    }

    setBatchSubmitError("");
    setBatchParsing(true);
    try {
      for (const [index, item] of items.entries()) {
        await parseItem(item, index);
      }
    } finally {
      setBatchParsing(false);
    }
  }

  function handleInfoItem(item: BatchAiImageItem, index: number) {
    console.log("batch-ai-info", {
      index,
      file: item.file,
      fileName: item.file.name,
      fileSize: item.file.size,
      fileType: item.file.type,
      parseResult: item.parseResult,
      draft: item.draft,
      selectedEvent,
    });
    setInfoItemId(item.id);
  }

  function updateItemDraft(itemId: string, updater: CreateState | ((prev: CreateState) => CreateState)) {
    setItems((prev) =>
      prev.map((current) =>
        current.id === itemId
          ? { ...current, draft: typeof updater === "function" ? updater(current.draft) : updater }
          : current,
      ),
    );
  }

  return (
    <>
      <div className="claim-batch-ai-page__header" style={panelHeaderStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          返回列表
        </button>
        <div className="claim-batch-ai-page__title" style={panelTitleStyle}>批量申请AI</div>
      </div>

      <div className="claim-batch-ai-page__actions" style={actionRowStyle}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={handleChooseFiles}
        />
        <button type="button" style={buttonPrimaryStyle} onClick={() => inputRef.current?.click()}>
          选择多个文件
        </button>
        <button
          type="button"
          style={disabledStyle(batchParseButtonStyle, batchParsing || !items.length)}
          onClick={() => void handleBatchParse()}
          disabled={batchParsing || !items.length}
        >
          <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
          {batchParsing ? "AI 批量解析中…" : "AI 批量解析"}
        </button>
        <button type="button" style={buttonSecondaryStyle} onClick={() => void handlePickEvent()}>
          选择活动
        </button>
        <span style={chipStyle}>已选择 {items.length} 个文件</span>
        <span style={chipStyle}>
          {selectedEvent ? `${selectedEvent.event_name || "未命名活动"} #${selectedEvent.id}` : "未选择活动"}
        </span>
        {batchSubmitError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{batchSubmitError}</span> : null}
      </div>

      {items.length ? (
        <>
          <div className="claim-batch-ai-page__grid" style={cardGridStyle}>
            {items.map((item, index) => (
              <div key={item.id} className="claim-batch-ai-page__card" style={imageCardStyle}>
                <button
                  type="button"
                  aria-label={`移除 ${item.file.name}`}
                  title="移除图片"
                  style={removeButtonStyle}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRemoveItem(item.id);
                  }}
                >
                  X
                </button>
                <button
                  type="button"
                  className="claim-batch-ai-page__image-wrap"
                  style={imagePreviewButtonStyle}
                  onClick={() => setPreviewItemId(item.id)}
                >
                  {isPdfFile(item.file) ? (
                    <div className="claim-batch-ai-page__pdf-thumb" style={pdfThumbStyle}>
                      <i className="fa-regular fa-file-pdf" aria-hidden="true" style={pdfThumbIconStyle} />
                      <span style={pdfThumbTextStyle}>PDF</span>
                    </div>
                  ) : (
                    <img src={item.previewUrl} alt={item.file.name} style={imageStyle} />
                  )}
                </button>
                <div className="claim-batch-ai-page__card-body" style={cardBodyStyle}>
                  <div className="claim-batch-ai-page__card-title" style={cardTitleStyle}>
                    文件 {index + 1}
                  </div>
                  <div className="claim-batch-ai-page__card-meta" style={cardMetaStyle}>
                    {item.file.name}
                  </div>
                  <div className="claim-batch-ai-page__card-meta" style={cardMetaStyle}>
                    {formatReceiptFileKind(item.file)}
                  </div>
                  <div className="claim-batch-ai-page__card-meta" style={cardMetaStyle}>
                    {Math.round(item.file.size / 1024)} KB
                  </div>
                  {item.parsing ? <span style={chipStyle}>解析中…</span> : null}
                  {item.parseError ? (
                    <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{item.parseError}</span>
                  ) : null}
                  {item.parseResult || hasVisibleSummary(item.draft) ? (
                    <div className="claim-batch-ai-page__summary" style={summaryBoxStyle}>
                      {item.parseResult ? <ConfidenceMeter value={item.parseResult.meta?.confidence} /> : null}
                      <SummaryLine label="金额" value={`RM ${formatMoney(draftTotal(item.draft))}`} />
                      <SummaryLine label="明细" value={`${item.draft.lineItems.filter((line) => line.description.trim()).length} 行`} />
                      <SummaryLine label="日期" value={item.draft.request_date} />
                      <SummaryLine label="商家" value={item.draft.vendor_name} />
                      <SummaryLine label="采购时间" value={formatDraftDateTime(item.draft.purchase_datetime)} />
                      <SummaryLine label="说明" value={item.draft.purpose} multiline />
                    </div>
                  ) : null}
                  <div className="claim-batch-ai-page__card-actions" style={cardActionRowStyle}>
                    <button
                      type="button"
                      style={{ ...parseButtonStyle, opacity: item.parsing ? 0.65 : 1, cursor: item.parsing ? "not-allowed" : "pointer" }}
                      onClick={() => void handleParseItem(item, index)}
                      disabled={item.parsing}
                    >
                      <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                      {item.parsing ? "解析中" : "解析"}
                    </button>
                    <button type="button" style={infoButtonStyle} onClick={() => handleInfoItem(item, index)}>
                      <i className="fa-solid fa-circle-info" aria-hidden="true" />
                      信息
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="claim-batch-ai-page__grand-total" style={grandTotalStyle}>
            <div style={grandTotalCopyStyle}>
              <span>Grand Total RM</span>
              <strong>{formatMoney(sumDraftAmounts(items))}</strong>
            </div>
            {batchSubmitting && submitProgress ? (
              <span style={submitProgressChipStyle}>
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                {submitProgress}
              </span>
            ) : null}
            {batchSubmitError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{batchSubmitError}</span> : null}
            <button
              type="button"
              style={disabledStyle(
                {
                  ...(selectedEvent ? buttonPrimaryStyle : buttonSecondaryStyle),
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                },
                batchSubmitting,
              )}
              onClick={() => void handleBatchSubmit()}
              disabled={batchSubmitting}
            >
              {batchSubmitting ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                  {submitProgress || "提交中…"}
                </>
              ) : (
                "批量提交"
              )}
            </button>
          </div>
        </>
      ) : (
        <div className="claim-batch-ai-page__placeholder" style={placeholderStyle}>
          请选择图片或 PDF 文件
        </div>
      )}

      {previewItem ? (
        <div className="claim-batch-ai-page__preview-modal" style={previewOverlayStyle} onClick={() => setPreviewItemId(null)}>
          <div className="claim-batch-ai-page__preview-dialog" style={previewDialogStyle} onClick={(event) => event.stopPropagation()}>
            <button type="button" aria-label="关闭预览" title="关闭预览" style={previewCloseButtonStyle} onClick={() => setPreviewItemId(null)}>
              X
            </button>
            {isPdfFile(previewItem.file) ? (
              <iframe title={previewItem.file.name} src={previewItem.previewUrl} style={previewPdfStyle} />
            ) : (
              <img src={previewItem.previewUrl} alt={previewItem.file.name} style={previewImageStyle} />
            )}
            <div className="claim-batch-ai-page__preview-name" style={previewNameStyle}>
              {previewItem.file.name}
            </div>
          </div>
        </div>
      ) : null}

      {infoItem ? (
        <div className="claim-batch-ai-page__info-modal" style={infoOverlayStyle} onClick={() => setInfoItemId(null)}>
          <div className="claim-batch-ai-page__info-dialog" style={infoDialogStyle} onClick={(event) => event.stopPropagation()}>
            <div className="claim-batch-ai-page__info-header" style={infoHeaderStyle}>
              <div>
                <div className="claim-batch-ai-page__info-title" style={infoTitleStyle}>申请资料</div>
                <div className="claim-batch-ai-page__info-meta" style={infoMetaStyle}>{infoItem.file.name}</div>
              </div>
              <button type="button" style={buttonGhostStyle} onClick={() => setInfoItemId(null)}>
                关闭
              </button>
            </div>

            <div className="claim-batch-ai-page__info-summary" style={actionRowStyle}>
              <span style={chipStyle}>
                {selectedEvent ? `${selectedEvent.event_name || "未命名活动"} #${selectedEvent.id}` : "未选择活动"}
              </span>
              {infoItem.parseResult ? (
                <span style={{ ...chipStyle, color: "var(--x-color-success)" }}>已解析</span>
              ) : (
                <span style={chipStyle}>尚未解析</span>
              )}
              <span style={{ ...chipStyle, background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)", fontWeight: 800 }}>
                合计 RM {formatMoney(draftTotal(infoItem.draft))}
              </span>
            </div>

            {/* 和「新建申请」同一套输入布局：关联活动 / 附件与签名 / 申请信息 / 用途与明细 / 商家信息 / 金额 */}
            <ClaimFormSections
              isMobile={isMobile}
              state={infoItem.draft}
              user={accountUser}
              onChange={(value) => updateItemDraft(infoItem.id, value)}
              lockedEvent
              showSign={false}
              ai={{
                parsing: infoItem.parsing,
                canParse: !infoItem.parsing,
                onParse: (model) => void parseItem(infoItem, items.findIndex((item) => item.id === infoItem.id), model, { debug: true }),
                outcome: infoOutcome,
                error: infoItem.parseError || null,
                hideUpload: true,
                note: "这张卡片的收据已带上，点下面按钮重新识别",
              }}
              attachmentSlot={
                <div style={infoAttachmentRowStyle}>
                  {isPdfFile(infoItem.file) ? (
                    <span style={infoThumbFallbackStyle}>
                      <i className="fa-regular fa-file-pdf" aria-hidden="true" />
                    </span>
                  ) : (
                    <img src={infoItem.previewUrl} alt={infoItem.file.name} style={infoThumbStyle} />
                  )}
                  <span style={infoAttachmentMetaStyle}>
                    <strong>{infoItem.file.name}</strong>
                    <span>
                      {formatReceiptFileKind(infoItem.file)} · {Math.round(infoItem.file.size / 1024)} KB
                    </span>
                  </span>
                  <button type="button" style={buttonSecondaryStyle} onClick={() => setPreviewItemId(infoItem.id)}>
                    大图预览
                  </button>
                </div>
              }
            />

            <div className="claim-batch-ai-page__info-footer" style={footerActionsStyle}>
              <button type="button" style={buttonGhostStyle} onClick={() => setInfoItemId(null)}>
                关闭
              </button>
              <button type="button" style={buttonPrimaryStyle} onClick={() => setInfoItemId(null)}>
                完成填写
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isSupportedReceiptFile(file: File) {
  return file.type.startsWith("image/") || isPdfFile(file);
}

function formatReceiptFileKind(file: File) {
  return isPdfFile(file) ? "PDF" : "图片";
}

function formatDraftDateTime(value: string) {
  return value ? value.replace("T", " ") : "";
}

function draftTotal(draft: CreateState) {
  return lineItemsTotal(draft.lineItems);
}

function hasVisibleSummary(draft: CreateState) {
  return Boolean(
    draftTotal(draft) ||
      draft.request_date ||
      draft.vendor_name ||
      draft.purchase_datetime ||
      draft.purpose ||
      hasFilledLine(draft.lineItems),
  );
}

function sumDraftAmounts(items: BatchAiImageItem[]) {
  return items.reduce((total, item) => total + draftTotal(item.draft), 0);
}

/** 每张单提交前的必填检查（签名与活动是整批共用的，不在这里查）。 */
function getMissingSubmitItems(items: BatchAiImageItem[]) {
  return items
    .map((item, index) => {
      const fields: string[] = [];
      if (!item.draft.applicant_name.trim()) fields.push("姓名");
      if (!item.draft.request_date) fields.push("日期");
      if (!item.draft.department_name.trim()) fields.push("部门");
      const lineError = validateLineItems(item.draft.lineItems);
      if (lineError) fields.push(lineError);
      return { index, fields };
    })
    .filter((item) => item.fields.length);
}

function formatMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function ConfidenceMeter({ value }: { value: unknown }) {
  const percent = confidencePercent(value);
  if (percent == null) {
    return null;
  }
  return (
    <div className="claim-batch-ai-page__confidence" style={confidenceStyle}>
      <div style={summaryLineStyle}>
        <span style={summaryLabelStyle}>信心</span>
        <span style={summaryValueStyle}>{percent}%</span>
      </div>
      <div style={confidenceTrackStyle}>
        <div style={{ ...confidenceFillStyle, width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SummaryLine({ label, value, multiline }: { label: string; value?: string; multiline?: boolean }) {
  if (!value) {
    return null;
  }
  return (
    <div style={summaryLineStyle}>
      <span style={summaryLabelStyle}>{label}</span>
      <span style={multiline ? summaryValueMultilineStyle : summaryValueStyle}>{value}</span>
    </div>
  );
}

function InfoField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label
      className={wide ? "claim-batch-ai-page__info-field claim-batch-ai-page__info-field--wide" : "claim-batch-ai-page__info-field"}
      style={wide ? { ...fieldStyle, ...wideFieldStyle } : fieldStyle}
    >
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function disabledStyle(style: CSSProperties, disabled: boolean): CSSProperties {
  if (!disabled) {
    return style;
  }
  return {
    ...style,
    opacity: 0.6,
    cursor: "not-allowed",
  };
}

const infoAttachmentRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "8px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  flexWrap: "wrap",
};
const infoThumbStyle: CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: "8px",
  objectFit: "cover",
  background: "var(--x-color-panel)",
};
const infoThumbFallbackStyle: CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--x-color-panel)",
  color: "var(--x-color-danger)",
  fontSize: "20px",
};
const infoAttachmentMetaStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  minWidth: 0,
  flex: 1,
};
const actionRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
  gap: "12px",
};

const imageCardStyle: CSSProperties = {
  minWidth: 0,
  position: "relative",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "6px",
  background: "var(--x-color-panel)",
  overflow: "hidden",
  display: "grid",
};

const imageWrapStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 10",
  background: "var(--x-color-panel-alt)",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const imagePreviewButtonStyle: CSSProperties = {
  ...imageWrapStyle,
  padding: 0,
  border: "none",
  cursor: "zoom-in",
  display: "grid",
  placeItems: "center",
};

const imageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const pdfThumbStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  gap: "6px",
  alignContent: "center",
  background: "linear-gradient(135deg, rgba(220,38,38,0.08), rgba(37,99,235,0.08))",
  color: "#991b1b",
};

const pdfThumbIconStyle: CSSProperties = {
  fontSize: "34px",
};

const pdfThumbTextStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 900,
  letterSpacing: 0,
};

const removeButtonStyle: CSSProperties = {
  position: "absolute",
  top: "6px",
  right: "6px",
  width: "26px",
  height: "26px",
  border: "1px solid rgba(255,255,255,0.72)",
  borderRadius: "50%",
  background: "rgba(17,24,39,0.76)",
  color: "#fff",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 800,
  lineHeight: 1,
};

const cardBodyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "10px 12px",
};

const cardTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const cardMetaStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const summaryBoxStyle: CSSProperties = {
  display: "grid",
  gap: "5px",
  padding: "8px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

const summaryLineStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "76px minmax(0, 1fr)",
  gap: "6px",
  alignItems: "start",
  minWidth: 0,
};

const summaryLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

const summaryValueStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const summaryValueMultilineStyle: CSSProperties = {
  ...summaryValueStyle,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  whiteSpace: "normal",
};

const confidenceStyle: CSSProperties = {
  display: "grid",
  gap: "5px",
};

const confidenceTrackStyle: CSSProperties = {
  height: "6px",
  borderRadius: "999px",
  overflow: "hidden",
  background: "var(--x-color-line-soft)",
};

const confidenceFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: "999px",
  background: "linear-gradient(135deg, #2563eb, #16a34a)",
};

const grandTotalStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
  padding: "10px 12px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontSize: "14px",
  fontWeight: 800,
};

const grandTotalCopyStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: "8px",
};

const submitProgressChipStyle: CSSProperties = {
  ...chipStyle,
  color: "var(--x-color-accent)",
  borderColor: "rgba(37,99,235,0.28)",
  background: "rgba(37,99,235,0.08)",
  fontWeight: 800,
};

const cardActionRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "6px",
  marginTop: "5px",
};

const parseButtonStyle: CSSProperties = {
  minWidth: 0,
  border: "none",
  borderRadius: "6px",
  padding: "8px 10px",
  background: "linear-gradient(135deg, #2563eb, #7c3aed)",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  fontSize: "13px",
  fontWeight: 800,
  boxShadow: "0 6px 14px rgba(37,99,235,0.22)",
};

const batchParseButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "6px",
  padding: "8px 11px",
  background: "linear-gradient(135deg, #2563eb, #7c3aed)",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  fontSize: "13px",
  fontWeight: 800,
  boxShadow: "0 6px 14px rgba(37,99,235,0.22)",
};


const infoButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "6px",
  padding: "8px 9px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "5px",
  fontSize: "12px",
  fontWeight: 700,
};

const previewOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  padding: "18px",
  boxSizing: "border-box",
  background: "rgba(15,23,42,0.84)",
  display: "grid",
  placeItems: "center",
  cursor: "zoom-out",
};

const previewDialogStyle: CSSProperties = {
  position: "relative",
  width: "min(100%, 980px)",
  maxHeight: "calc(100dvh - 36px)",
  display: "grid",
  gap: "8px",
  cursor: "default",
};

const previewImageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxHeight: "calc(100dvh - 90px)",
  objectFit: "contain",
  borderRadius: "6px",
  background: "#fff",
};

const previewPdfStyle: CSSProperties = {
  width: "min(100%, 980px)",
  height: "calc(100dvh - 90px)",
  border: "none",
  borderRadius: "6px",
  background: "#fff",
};

const previewCloseButtonStyle: CSSProperties = {
  position: "absolute",
  top: "8px",
  right: "8px",
  width: "30px",
  height: "30px",
  border: "1px solid rgba(255,255,255,0.72)",
  borderRadius: "50%",
  background: "rgba(17,24,39,0.78)",
  color: "#fff",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 800,
  lineHeight: 1,
};

const previewNameStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#fff",
  fontSize: "12px",
  textAlign: "center",
};

const infoOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10001,
  padding: "14px",
  boxSizing: "border-box",
  background: "rgba(15,23,42,0.58)",
  display: "grid",
  placeItems: "center",
};

const infoDialogStyle: CSSProperties = {
  width: "min(100%, 760px)",
  maxHeight: "calc(100dvh - 28px)",
  overflow: "auto",
  boxSizing: "border-box",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  display: "grid",
  gap: "10px",
};

const infoHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "8px",
  paddingBottom: "8px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const infoTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const infoMetaStyle: CSSProperties = {
  marginTop: "3px",
  maxWidth: "520px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};
