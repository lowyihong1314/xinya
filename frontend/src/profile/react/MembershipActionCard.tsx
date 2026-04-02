import type { CSSProperties } from "react";

function formatDateOnly(value: string | null | undefined) {
  if (!value) {
    return "未记录";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function MembershipActionCard({
  isMember,
  hasBoundNric,
  nextExpiryDate,
  actionBusy,
  isMobile = false,
  onAction,
}: {
  isMember: boolean;
  hasBoundNric: boolean;
  nextExpiryDate?: string | null;
  actionBusy?: boolean;
  isMobile?: boolean;
  onAction: () => void;
}) {
  const title = isMember
    ? `下一次会员过期时间：${formatDateOnly(nextExpiryDate)}`
    : "立刻填写注册会员表格";
  const body = isMember
    ? "系统会直接为你生成一份续费付款链接，上传付款截图后即可进入审核。"
    : hasBoundNric
      ? "会直接打开会员注册表格，并尽量用你当前的 user_data 帮你预填。"
      : "升级会员前，请先回到“资料”页签补上 NRIC，系统会据此绑定你的成员档案。";
  const actionLabel = isMember ? "直接续费" : "立刻填写注册会员表格";

  return (
    <div style={cardStyle(isMember, isMobile)}>
      <div style={eyebrowStyle(isMember)}>{isMember ? "Member Active" : "Member Upgrade"}</div>
      <div style={titleStyle(isMobile)}>{title}</div>
      <div style={bodyStyle}>{body}</div>
      <div style={badgeRowStyle}>
        <span style={badgeStyle(isMember)}>
          {isMember ? "会员绿色通道" : hasBoundNric ? "可提交升级申请" : "需先绑定 NRIC"}
        </span>
      </div>
      <button type="button" style={buttonStyle(isMember, isMobile)} onClick={onAction} disabled={Boolean(actionBusy)}>
        {actionBusy ? (isMember ? "生成续费链接中…" : "打开中…") : actionLabel}
      </button>
    </div>
  );
}

function cardStyle(isMember: boolean, isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "10px" : "12px",
    padding: isMobile ? "14px" : "18px",
    borderRadius: isMobile ? "16px" : "20px",
    background: isMember
      ? "linear-gradient(135deg, rgba(2,122,72,0.12), rgba(236,253,243,0.92))"
      : "linear-gradient(135deg, rgba(15,118,110,0.08), rgba(255,255,255,0.96))",
    border: isMember ? "1px solid rgba(2,122,72,0.18)" : "1px solid rgba(15,118,110,0.14)",
    boxSizing: "border-box",
  };
}

function eyebrowStyle(isMember: boolean): CSSProperties {
  return {
    fontSize: "12px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 800,
    color: isMember ? "var(--x-color-success)" : "var(--x-color-accent-strong)",
  };
}

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: isMobile ? "18px" : "20px",
    fontWeight: 900,
    lineHeight: 1.3,
    color: "var(--x-color-ink)",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
}

const bodyStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const badgeRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

function badgeStyle(isMember: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    width: "fit-content",
    padding: "7px 11px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
    background: isMember ? "var(--x-color-success-soft)" : "rgba(15,118,110,0.1)",
    color: isMember ? "var(--x-color-success)" : "var(--x-color-accent-strong)",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
}

function buttonStyle(isMember: boolean, isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "100%" : "fit-content",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 18px",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    color: "white",
    background: isMember ? "linear-gradient(135deg, #027a48, #16a34a)" : "linear-gradient(135deg, #0f766e, #1d4ed8)",
    boxSizing: "border-box",
  };
}
