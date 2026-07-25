import { useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";

import { useUserState } from "../../../../app/UserState";
import { render_sign_modal } from "../../../../../../static/js/sign_tools.js";
import { ClaimCreateForm } from "./ClaimCreateForm";
import { buildInitialCreateState, submitCreateClaim, validateCreateState } from "./submitCreate";
import type { AccountUser } from "./types";

// 从预算支出行「提交报销」弹出的自包含报销申请弹窗。
export function ClaimCreateModal({
  eventId,
  eventName,
  budgetLine,
  onClose,
  onSuccess,
}: {
  eventId: number;
  eventName?: string;
  budgetLine: { id: number; category?: string; amount?: number | null };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { user, isMobile } = useUserState();
  const accountUser = (user as AccountUser | null) ?? null;

  const [state, setState] = useState(() => {
    const base = buildInitialCreateState(accountUser);
    return {
      ...base,
      amount: budgetLine.amount != null ? String(budgetLine.amount) : "",
      purpose: budgetLine.category || "",
      selectedEvent: { id: eventId, event_name: eventName },
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSign() {
    const next = await render_sign_modal(state.signJsonData);
    if (!next) return;
    setState((prev) => ({ ...prev, signJsonData: next }));
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    setState((prev) => ({ ...prev, files: Array.from(event.target.files || []) }));
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
      await submitCreateClaim(state, accountUser, { eventBudgetId: budgetLine.id });
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
          aiFilling={false}
          showAiFill={false}
          lockedEvent
          budgetLine={{ id: budgetLine.id, category: budgetLine.category }}
          title="提交报销申请"
          backLabel="取消"
          submitLabel="提交报销"
          onBack={onClose}
          onChange={setState}
          onAiFill={() => {}}
          onPickEvent={() => {}}
          onSign={() => void handleSign()}
          onSubmit={() => void handleSubmit()}
          onFilesChange={handleFiles}
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
