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
  onAction,
}: {
  isMember: boolean;
  hasBoundNric: boolean;
  nextExpiryDate?: string | null;
  actionBusy?: boolean;
  onAction: () => void;
}) {
  const title = isMember
    ? `下一次会员过期时间：${formatDateOnly(nextExpiryDate)}`
    : "立刻填写报名升级会员";
  const body = isMember
    ? "系统会直接为你生成一份续费付款链接，上传付款截图后即可进入审核。"
    : hasBoundNric
      ? "会先打开独立的会员申请表，再进入会员付款页。"
      : "升级会员前，请先回到“资料”页签补上 NRIC，系统会据此绑定你的成员档案。";
  const actionLabel = isMember ? "直接续费" : "立刻填写报名升级会员";

  return (
    <div style={cardStyle(isMember)}>
      <div style={eyebrowStyle(isMember)}>{isMember ? "Member Active" : "Member Upgrade"}</div>
      <div style={titleStyle}>{title}</div>
      <div style={bodyStyle}>{body}</div>
      <div style={badgeRowStyle}>
        <span style={badgeStyle(isMember)}>
          {isMember ? "会员绿色通道" : hasBoundNric ? "可提交升级申请" : "需先绑定 NRIC"}
        </span>
      </div>
      <button type="button" style={buttonStyle(isMember)} onClick={onAction} disabled={Boolean(actionBusy)}>
        {actionBusy ? (isMember ? "生成续费链接中…" : "打开中…") : actionLabel}
      </button>
    </div>
  );
}

function cardStyle(isMember: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "12px",
    padding: "18px",
    borderRadius: "20px",
    background: isMember
      ? "linear-gradient(135deg, rgba(2,122,72,0.12), rgba(236,253,243,0.92))"
      : "linear-gradient(135deg, rgba(15,118,110,0.08), rgba(255,255,255,0.96))",
    border: isMember ? "1px solid rgba(2,122,72,0.18)" : "1px solid rgba(15,118,110,0.14)",
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

const titleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 900,
  lineHeight: 1.25,
  color: "var(--x-color-ink)",
};

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
    width: "fit-content",
    padding: "7px 11px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
    background: isMember ? "var(--x-color-success-soft)" : "rgba(15,118,110,0.1)",
    color: isMember ? "var(--x-color-success)" : "var(--x-color-accent-strong)",
  };
}

function buttonStyle(isMember: boolean): CSSProperties {
  return {
    width: "fit-content",
    padding: "12px 18px",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    color: "white",
    background: isMember ? "linear-gradient(135deg, #027a48, #16a34a)" : "linear-gradient(135deg, #0f766e, #1d4ed8)",
  };
}
