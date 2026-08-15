import { useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../../../app/UserState";
import { render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import { ClaimCreateForm, isReadableBillFile, type CreateState } from "./ClaimCreateForm";
import { readClaimBill } from "./api";
import { buildReadBillFill } from "./readBillFill";
import type { AiFillOutcome } from "./AiFillPanel";
import { buildInitialCreateState, submitCreateClaim, validateCreateState } from "./submitCreate";
import type { AccountUser } from "./types";

// 活动级「新建报销」弹窗：预填并锁定活动，提交后报销以 event_id 关联该活动。
export function ClaimCreateModal({
  eventId,
  eventName,
  onClose,
  onSuccess,
}: {
  eventId: number;
  eventName?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, isMobile } = useUserState();
  const accountUser = (user as AccountUser | null) ?? null;

  const [state, setState] = useState<CreateState>(() => ({
    ...buildInitialCreateState(accountUser),
    selectedEvent: { id: eventId, event_name: eventName },
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiFilling, setAiFilling] = useState(false);
  const [aiOutcome, setAiOutcome] = useState<AiFillOutcome>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSnapshot, setAiSnapshot] = useState<CreateState | null>(null);

  // 活动预算里也能直接 AI 读单，逻辑与 finance 新建页共用 buildReadBillFill
  async function handleAiFill(model: "auto" | "byteplus") {
    const receiptFile = state.files.find(isReadableBillFile);
    if (!receiptFile) {
      setAiError("请先选择收据图片或 PDF");
      return;
    }
    setAiError(null);
    setAiFilling(true);
    try {
      const result = await readClaimBill(receiptFile, model);
      const data = result.data;
      if (!data) throw new Error("AI 读单没有返回识别结果");
      const { patch, filledLabels, lineCount, total } = buildReadBillFill(data);
      if (!filledLabels.length) {
        setAiError("AI 没有识别到可填写的内容，请手动输入");
        return;
      }
      setAiSnapshot(state);
      setState((prev) => ({ ...prev, ...patch }));
      setAiOutcome({ filledLabels, lineCount, total, confidence: result.meta?.confidence, model });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 读单失败");
    } finally {
      setAiFilling(false);
    }
  }

  function handleUndoAi() {
    if (!aiSnapshot) return;
    setState(aiSnapshot);
    setAiSnapshot(null);
    setAiOutcome(null);
  }

  async function handleSign() {
    const next = await render_sign_modal(state.signJsonData);
    if (!next) return;
    setState((prev) => ({ ...prev, signJsonData: next }));
  }

  async function handleSubmit() {
    setError(null);
    const validationError = validateCreateState(state);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      await submitCreateClaim(state, accountUser);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={sheetStyle} onClick={(e) => e.stopPropagation()}>
        {error ? <div style={errorStyle}>{error}</div> : null}
        <ClaimCreateForm
          isMobile={isMobile}
          state={state}
          user={accountUser}
          submitting={submitting}
          lockedEvent
          title="新建报销申请"
          backLabel="取消"
          submitLabel="提交报销"
          onBack={onClose}
          onChange={setState}
          onSign={() => void handleSign()}
          onSubmit={() => void handleSubmit()}
          ai={{
            parsing: aiFilling,
            canParse: state.files.some(isReadableBillFile),
            onParse: (model) => void handleAiFill(model),
            outcome: aiOutcome,
            error: aiError,
            onUndo: aiSnapshot ? handleUndoAi : undefined,
          }}
        />
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "rgba(15,23,42,0.45)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "24px 12px",
  overflowY: "auto",
};
const sheetStyle: CSSProperties = {
  width: "min(760px, 100%)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  borderRadius: "14px",
  boxShadow: "0 24px 60px var(--x-color-shadow)",
  padding: "16px",
  display: "grid",
  gap: "12px",
};
const errorStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
  fontSize: "13px",
};
