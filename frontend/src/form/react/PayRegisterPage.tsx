import { useMemo, useState } from "react";

import { LogoQrBadge } from "../../components/LogoQrBadge";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import type { FormFee } from "../../CRM/form/react/types";
import { calcAgeFromNric } from "./nric";
import {
  createMemberPayment,
  fetchPaymentQuote,
  resolveStaticUrl,
  type QuoteMember,
} from "./payApi";

type Step = "nric" | "fee" | "proof" | "success";

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "nric", label: "报名资料" },
  { key: "fee", label: "选择收费" },
  { key: "proof", label: "上传付款" },
  { key: "success", label: "完成" },
];

type PayRegisterPageProps = {
  formId: number;
  formTitle?: string;
};

function formatAmount(amount: number | string): string {
  const value = Number(amount);
  return Number.isFinite(value) ? `RM ${value.toFixed(2)}` : `RM ${amount}`;
}

function formatAgeRange(fee: FormFee): string {
  const from = fee.age_range_from == null ? null : Number(fee.age_range_from);
  const to = fee.age_range_to == null ? null : Number(fee.age_range_to);
  if (from != null && to != null) return `${from} - ${to} 岁`;
  if (from != null) return `${from} 岁以上`;
  if (to != null) return `${to} 岁以下`;
  return "不限年龄";
}

function memberDisplayName(member: QuoteMember): string {
  if (!member) return "";
  return member.name_cn || member.name || member.name_nric || "";
}

export function PayRegisterPage({ formId, formTitle }: PayRegisterPageProps) {
  useEnsureDesignTokens();

  const [step, setStep] = useState<Step>("nric");
  const [nric, setNric] = useState("");
  const [serverAge, setServerAge] = useState<number | null>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [memberName, setMemberName] = useState("");
  const [fees, setFees] = useState<FormFee[]>([]);
  const [selectedFee, setSelectedFee] = useState<FormFee | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);

  const [loadingQuote, setLoadingQuote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notMember, setNotMember] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  const liveAge = useMemo(() => calcAgeFromNric(nric), [nric]);
  const posterUrl = resolveStaticUrl(`/api/form/event_poster/${formId}/cache`);

  function resetToStart() {
    setStep("nric");
    setServerAge(null);
    setIsMember(null);
    setMemberName("");
    setFees([]);
    setSelectedFee(null);
    setProofFile(null);
    setError(null);
    setNotMember(false);
    setResultMessage("");
  }

  async function handleQuery() {
    setError(null);
    setNotMember(false);
    const digits = nric.replace(/\D/g, "");
    if (digits.length < 6) {
      setError("请输入至少 6 位数字的身份证号码（IC）");
      return;
    }
    if (liveAge == null) {
      setError("无法从 IC 推算年龄，请检查号码是否正确");
      return;
    }

    setLoadingQuote(true);
    try {
      const quote = await fetchPaymentQuote(formId, digits);
      setNric(digits);
      setServerAge(quote.age);
      setIsMember(quote.is_member);
      setMemberName(memberDisplayName(quote.member));

      if (!quote.is_member) {
        setFees([]);
        setNotMember(true);
        return;
      }
      if (!quote.fees.length) {
        setFees([]);
        setError("没有符合您年龄的收费项，请联系管理员");
        return;
      }
      setFees(quote.fees);
      setSelectedFee(quote.fees[0] ?? null);
      setStep("fee");
    } catch (err) {
      setError(err instanceof Error ? err.message : "查询失败，请稍后再试");
    } finally {
      setLoadingQuote(false);
    }
  }

  function chooseFee(fee: FormFee) {
    setSelectedFee(fee);
    setError(null);
    setStep("proof");
  }

  async function handleSubmit() {
    if (!selectedFee) {
      setError("请先选择收费项");
      return;
    }
    if (!proofFile) {
      setError("请上传付款截图");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await createMemberPayment(
        formId,
        { nric, fee_id: selectedFee.id, payment_mode: "QR" },
        proofFile,
      );
      if (res.status !== "success") {
        throw new Error(res.message || "提交失败，请稍后再试");
      }
      setResultMessage(res.message || "付款资料已提交");
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  const activeIndex = STEP_LABELS.findIndex((item) => item.key === step);

  return (
    <div style={styles.page}>
      <LogoQrBadge />
      {posterUrl ? (
        <div
          style={{ ...styles.poster, backgroundImage: `url(${posterUrl})` }}
          aria-hidden
        />
      ) : null}
      <div style={styles.posterOverlay} aria-hidden />

      <div style={styles.shell}>
        <div style={styles.card}>
          <header style={styles.header}>
            <div style={styles.eyebrow}>报名付款</div>
            <h1 style={styles.title}>{formTitle || "报名付款"}</h1>
          </header>

          <StepIndicator activeIndex={activeIndex} />

          {error ? <div style={styles.errorBox}>{error}</div> : null}

          {step === "nric" ? (
            <NricStep
              nric={nric}
              onNricChange={setNric}
              liveAge={liveAge}
              loading={loadingQuote}
              notMember={notMember}
              onQuery={handleQuery}
            />
          ) : null}

          {step === "fee" ? (
            <FeeSelectStep
              fees={fees}
              age={serverAge}
              memberName={memberName}
              onBack={() => setStep("nric")}
              onChoose={chooseFee}
            />
          ) : null}

          {step === "proof" && selectedFee ? (
            <PaymentProofStep
              fee={selectedFee}
              proofFile={proofFile}
              submitting={submitting}
              onPickFile={setProofFile}
              onBack={() => setStep("fee")}
              onSubmit={handleSubmit}
            />
          ) : null}

          {step === "success" && selectedFee ? (
            <SuccessReceipt
              fee={selectedFee}
              nric={nric}
              memberName={memberName}
              message={resultMessage}
              onRestart={resetToStart}
            />
          ) : null}
        </div>

        <p style={styles.footNote}>付款资料提交后需管理员核对，请保留您的付款截图。</p>
      </div>
    </div>
  );
}

function StepIndicator({ activeIndex }: { activeIndex: number }) {
  return (
    <ol style={styles.steps}>
      {STEP_LABELS.map((item, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={item.key} style={styles.stepItem}>
            <span
              style={{
                ...styles.stepDot,
                ...(done ? styles.stepDotDone : {}),
                ...(active ? styles.stepDotActive : {}),
              }}
            >
              {done ? "✓" : index + 1}
            </span>
            <span
              style={{
                ...styles.stepLabel,
                ...(active ? styles.stepLabelActive : {}),
              }}
            >
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function NricStep({
  nric,
  onNricChange,
  liveAge,
  loading,
  notMember,
  onQuery,
}: {
  nric: string;
  onNricChange: (value: string) => void;
  liveAge: number | null;
  loading: boolean;
  notMember: boolean;
  onQuery: () => void;
}) {
  return (
    <div style={styles.stepBody}>
      <p style={styles.help}>输入身份证号码（IC）查询您可付款的项目。</p>

      <label style={styles.fieldLabel} htmlFor="pay-nric">
        身份证号码 (IC NO)
      </label>
      <input
        id="pay-nric"
        style={styles.input}
        inputMode="numeric"
        autoComplete="off"
        placeholder="例如 991031015177"
        value={nric}
        disabled={loading}
        onChange={(event) => onNricChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onQuery();
        }}
      />

      <div style={styles.ageRow}>
        <span style={styles.ageLabel}>年龄</span>
        <span style={styles.ageValue}>{liveAge != null ? `${liveAge} 岁` : "—"}</span>
      </div>

      {notMember ? (
        <div style={styles.warnBox}>
          未找到您的报名记录，请先完成报名后再来付款。如有疑问请联系管理员。
        </div>
      ) : null}

      <button
        type="button"
        style={{ ...styles.primaryButton, ...(loading ? styles.buttonDisabled : {}) }}
        onClick={onQuery}
        disabled={loading}
      >
        {loading ? "查询中…" : "查询付款选项"}
      </button>
    </div>
  );
}

function FeeSelectStep({
  fees,
  age,
  memberName,
  onBack,
  onChoose,
}: {
  fees: FormFee[];
  age: number | null;
  memberName: string;
  onBack: () => void;
  onChoose: (fee: FormFee) => void;
}) {
  return (
    <div style={styles.stepBody}>
      <p style={styles.help}>
        {memberName ? `${memberName}，` : ""}
        {age != null ? `按年龄 ${age} 岁，` : ""}以下是可付款的项目，请选择一项。
      </p>

      <div style={styles.feeList}>
        {fees.map((fee) => (
          <button
            key={fee.id}
            type="button"
            style={styles.feeCard}
            onClick={() => onChoose(fee)}
          >
            <div style={styles.feeCardTop}>
              <span style={styles.feeCategory}>{fee.category || "收费项"}</span>
              <span style={styles.feeAmount}>{formatAmount(fee.amount)}</span>
            </div>
            <div style={styles.feeMeta}>{formatAgeRange(fee)}</div>
            {fee.description ? (
              <div style={styles.feeDesc}>{fee.description}</div>
            ) : null}
          </button>
        ))}
      </div>

      <button type="button" style={styles.ghostButton} onClick={onBack}>
        ← 返回修改 IC
      </button>
    </div>
  );
}

function PaymentProofStep({
  fee,
  proofFile,
  submitting,
  onPickFile,
  onBack,
  onSubmit,
}: {
  fee: FormFee;
  proofFile: File | null;
  submitting: boolean;
  onPickFile: (file: File | null) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const qrUrl = resolveStaticUrl(fee.image_path);
  return (
    <div style={styles.stepBody}>
      <div style={styles.summaryBox}>
        <span style={styles.summaryLabel}>{fee.category || "收费项"}</span>
        <span style={styles.summaryAmount}>{formatAmount(fee.amount)}</span>
      </div>
      <p style={styles.help}>请使用以下收款码付款，再上传付款截图。</p>

      {qrUrl ? (
        <img src={qrUrl} alt="收款码" style={styles.qrImage} />
      ) : (
        <div style={styles.warnBox}>此项目暂无收款码，请联系管理员获取付款方式。</div>
      )}

      <label style={styles.fieldLabel} htmlFor="pay-proof">
        付款截图
      </label>
      <input
        id="pay-proof"
        style={styles.fileInput}
        type="file"
        accept="image/png,image/jpeg,.heic,.heif"
        disabled={submitting}
        onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
      />
      {proofFile ? <div style={styles.fileHint}>已选择：{proofFile.name}</div> : null}

      <button
        type="button"
        style={{
          ...styles.primaryButton,
          ...(submitting || !proofFile ? styles.buttonDisabled : {}),
        }}
        onClick={onSubmit}
        disabled={submitting || !proofFile}
      >
        {submitting ? "提交中…" : "提交付款截图"}
      </button>
      <button type="button" style={styles.ghostButton} onClick={onBack} disabled={submitting}>
        ← 返回选择收费项
      </button>
    </div>
  );
}

function SuccessReceipt({
  fee,
  nric,
  memberName,
  message,
  onRestart,
}: {
  fee: FormFee;
  nric: string;
  memberName: string;
  message: string;
  onRestart: () => void;
}) {
  return (
    <div style={styles.stepBody}>
      <div style={styles.successIcon}>✓</div>
      <h2 style={styles.successTitle}>{message || "付款资料已提交"}</h2>
      <p style={styles.help}>我们已收到您的付款资料，正在等待管理员核对。</p>

      <dl style={styles.receipt}>
        <div style={styles.receiptRow}>
          <dt style={styles.receiptKey}>收费项</dt>
          <dd style={styles.receiptVal}>{fee.category || "收费项"}</dd>
        </div>
        <div style={styles.receiptRow}>
          <dt style={styles.receiptKey}>金额</dt>
          <dd style={styles.receiptVal}>{formatAmount(fee.amount)}</dd>
        </div>
        {memberName ? (
          <div style={styles.receiptRow}>
            <dt style={styles.receiptKey}>姓名</dt>
            <dd style={styles.receiptVal}>{memberName}</dd>
          </div>
        ) : null}
        <div style={styles.receiptRow}>
          <dt style={styles.receiptKey}>IC</dt>
          <dd style={styles.receiptVal}>{nric}</dd>
        </div>
        <div style={styles.receiptRow}>
          <dt style={styles.receiptKey}>状态</dt>
          <dd style={styles.receiptVal}>待核对</dd>
        </div>
      </dl>

      <button type="button" style={styles.ghostButton} onClick={onRestart}>
        再查询一次
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: "relative",
    minHeight: "100vh",
    width: "100%",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
    overflowX: "hidden",
  },
  poster: {
    position: "fixed",
    inset: 0,
    backgroundSize: "cover",
    backgroundPosition: "center",
    filter: "blur(28px) brightness(0.7)",
    transform: "scale(1.1)",
    zIndex: 0,
  },
  posterOverlay: {
    position: "fixed",
    inset: 0,
    background: "linear-gradient(160deg, rgba(18,52,59,0.72), rgba(15,118,110,0.55))",
    zIndex: 0,
  },
  shell: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "32px 16px 40px",
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: "var(--x-color-panel-strongest)",
    borderRadius: "var(--x-radius-lg)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    padding: "24px 22px 26px",
    boxSizing: "border-box",
  },
  header: {
    textAlign: "center",
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "var(--x-color-accent)",
    fontWeight: 700,
  },
  title: {
    margin: "6px 0 0",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--x-color-ink)",
    lineHeight: 1.3,
  },
  steps: {
    display: "flex",
    justifyContent: "space-between",
    listStyle: "none",
    padding: 0,
    margin: "0 0 20px",
    gap: 4,
  },
  stepItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    border: "1px solid var(--x-color-line)",
  },
  stepDotActive: {
    background: "var(--x-color-accent)",
    color: "#fff",
    borderColor: "var(--x-color-accent)",
  },
  stepDotDone: {
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    borderColor: "var(--x-color-accent-border)",
  },
  stepLabel: {
    fontSize: 11,
    color: "var(--x-color-ink-muted)",
    textAlign: "center",
  },
  stepLabelActive: {
    color: "var(--x-color-accent-strong)",
    fontWeight: 700,
  },
  stepBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  help: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--x-color-ink-muted)",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--x-color-ink)",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    fontSize: 16,
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  ageRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-panel-alt)",
  },
  ageLabel: {
    fontSize: 13,
    color: "var(--x-color-ink-muted)",
  },
  ageValue: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--x-color-ink)",
  },
  primaryButton: {
    width: "100%",
    padding: "13px 16px",
    fontSize: 15,
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  ghostButton: {
    width: "100%",
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--x-color-accent-strong)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  errorBox: {
    padding: "10px 14px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    border: "1px solid var(--x-color-danger-border)",
    fontSize: 13,
    marginBottom: 12,
  },
  warnBox: {
    padding: "12px 14px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-warning-soft)",
    color: "var(--x-color-warning)",
    border: "1px solid var(--x-color-warning-border)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  feeList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  feeCard: {
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  feeCardTop: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  feeCategory: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--x-color-ink)",
  },
  feeAmount: {
    fontSize: 16,
    fontWeight: 800,
    color: "var(--x-color-accent-strong)",
    whiteSpace: "nowrap",
  },
  feeMeta: {
    fontSize: 12,
    color: "var(--x-color-ink-muted)",
  },
  feeDesc: {
    fontSize: 12,
    color: "var(--x-color-ink-muted)",
    lineHeight: 1.5,
  },
  summaryBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
  },
  summaryLabel: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
  },
  summaryAmount: {
    fontSize: 18,
    fontWeight: 800,
    color: "var(--x-color-accent-strong)",
  },
  qrImage: {
    width: "100%",
    maxWidth: 280,
    alignSelf: "center",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line)",
    background: "#fff",
  },
  fileInput: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 14,
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px dashed var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
  },
  fileHint: {
    fontSize: 12,
    color: "var(--x-color-success)",
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    alignSelf: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    color: "#fff",
    background: "var(--x-color-success)",
    marginBottom: 4,
  },
  successTitle: {
    margin: 0,
    textAlign: "center",
    fontSize: 18,
    fontWeight: 700,
    color: "var(--x-color-ink)",
  },
  receipt: {
    margin: 0,
    padding: "12px 16px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-panel-alt)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  receiptRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    margin: 0,
  },
  receiptKey: {
    fontSize: 13,
    color: "var(--x-color-ink-muted)",
    margin: 0,
  },
  receiptVal: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--x-color-ink)",
    margin: 0,
    textAlign: "right",
  },
  footNote: {
    marginTop: 16,
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    maxWidth: 460,
  },
};
