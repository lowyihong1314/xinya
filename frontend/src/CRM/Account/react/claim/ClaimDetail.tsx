import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { openPreviewModal } from "../../../../js/attachment_preview";
import {
  approverAvatarStyle,
  approverCardStyle,
  approverMeStyle,
  approverRowStyle,
  approverTimeStyle,
  chipStyle,
  attachmentCardStyle,
  attachmentGridStyle,
  attachmentMetaStyle,
  attachmentNameStyle,
  buttonApproveStyle,
  buttonGhostStyle,
  buttonPrimaryStyle,
  buttonRejectStyle,
  detailGridStyle,
  detailLabelStyle,
  detailRowStyle,
  detailValueStyle,
  footerActionsStyle,
  panelHeaderStyle,
  panelTitleStyle,
  purposeBoxStyle,
  sectionStyle,
  sectionTitleStyle,
  statusBadgeStyle,
} from "./claimStyles";
import type { ApproverUserProfile, ClaimAttachment, ClaimRecord } from "./types";

type ClaimDetailProps = {
  isMobile: boolean;
  claim: ClaimRecord;
  hasAccountPermission: boolean;
  isApprovedByMe: boolean;
  currentUserId?: number;
  onBack: () => void;
  onApprove: () => void;
  onReject: () => void;
};

export function ClaimDetail({
  isMobile,
  claim,
  hasAccountPermission,
  isApprovedByMe,
  currentUserId,
  onBack,
  onApprove,
  onReject,
}: ClaimDetailProps) {
  const [approverUsers, setApproverUsers] = useState<Record<number, ApproverUserProfile>>({});
  const [approverLoadError, setApproverLoadError] = useState("");
  const [selectedApprover, setSelectedApprover] = useState<{
    userId: number;
    name: string;
    sign: { strokes?: Array<{ points?: Array<{ x: number; y: number }> }> } | null;
  } | null>(null);
  const claimStatus = useMemo(() => getClaimStatus(claim), [claim]);

  useEffect(() => {
    const approverIds = Array.from(new Set((claim.approver_data || []).map((item) => item.user_id).filter(Boolean)));
    if (!approverIds.length) {
      setApproverUsers({});
      setApproverLoadError("");
      return;
    }

    let cancelled = false;

    async function loadApproverUsers() {
      let hasError = false;
      const entries = await Promise.all(
        approverIds.map(async (userId) => {
          try {
            const response = await fetch(`/api/user_control/get_user_detail/${userId}`, {
              credentials: "include",
            });
            const payload = (await response.json().catch(() => ({}))) as ApproverUserProfile;
            if (!response.ok) {
              hasError = true;
              return null;
            }
            return [userId, payload] as const;
          } catch {
            hasError = true;
            return null;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setApproverUsers(
        Object.fromEntries(entries.filter((item): item is readonly [number, ApproverUserProfile] => Boolean(item))),
      );
      setApproverLoadError(hasError ? "部分审批人信息加载失败" : "");
    }

    void loadApproverUsers();

    return () => {
      cancelled = true;
    };
  }, [claim]);

  return (
    <div className="claim-detail" style={{ display: "grid", gap: "16px" }}>
      <div className="claim-detail__header" style={panelHeaderStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          返回列表
        </button>
        <div className="claim-detail__title" style={panelTitleStyle}>申请详情 #{claim.id}</div>
      </div>

      <div className="claim-detail__status-row" style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <div className="claim-detail__status-badge" style={statusBadgeStyle(claimStatus)}>{statusText(claimStatus)}</div>
        <span style={chipStyle}>
          批准 {claim.approver_data?.filter((item) => !item.reject).length || 0} 人
        </span>
        <span style={chipStyle}>
          拒绝 {claim.approver_data?.filter((item) => item.reject).length || 0} 人
        </span>
        {approverLoadError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{approverLoadError}</span> : null}
      </div>

      <div className="claim-detail__grid" style={detailGridStyle(isMobile)}>
        <DetailRow label="申请人" value={claim.applicant_name} />
        <DetailRow label="金额" value={`RM ${safeMoney(claim.amount)}`} />
        <DetailRow label="日期" value={claim.request_date} />
        <DetailRow label="部门" value={claim.department_name || String(claim.department_id ?? "-")} />
        <DetailRow
          label="活动"
          value={claim.event_id ? `${claim.event_name || "未命名活动"} (#${claim.event_id})` : "-"}
        />
        <DetailRow label="创建时间" value={formatDateTime(claim.created_at)} />
      </div>

      {claim.purpose ? <div className="claim-detail__purpose" style={purposeBoxStyle}>{claim.purpose}</div> : null}

      {claim.approver_data?.length || (claim.attachments || []).length ? (
        <div
          className="claim-detail__section-row"
          style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "stretch" }}
        >
          {claim.approver_data?.length ? (
            <div className="claim-detail__section-slot" style={{ flex: "1 1 320px", minWidth: 0 }}>
              <Section title="审批状态">
                <div className="claim-detail__approvers" style={approverRowStyle}>
                  {claim.approver_data.map((approver) => (
                    <button
                      type="button"
                      className="claim-detail__approver-card"
                      key={`${approver.user_id}-${approver.decided_at || ""}`}
                      style={{
                        ...approverCardStyle,
                        cursor: parseApproverSign(approver.sign_json_data) ? "pointer" : "default",
                        textAlign: "center",
                      }}
                      onClick={() => {
                        const sign = parseApproverSign(approver.sign_json_data);
                        if (!sign?.strokes?.length) {
                          return;
                        }
                        setSelectedApprover({
                          userId: approver.user_id,
                          name:
                            approverUsers[approver.user_id]?.display_name ||
                            approverUsers[approver.user_id]?.name_NRIC ||
                            approverUsers[approver.user_id]?.username ||
                            `用户 #${approver.user_id}`,
                          sign,
                        });
                      }}
                    >
                      <img
                        src={`/api/user_control/get_profile_image/${approver.user_id}`}
                        alt=""
                        style={approverAvatarStyle(approver.reject)}
                      />
                      <div className="claim-detail__approver-name" style={{ fontSize: "13px", fontWeight: 700, textAlign: "center" }}>
                        {approverUsers[approver.user_id]?.display_name ||
                          approverUsers[approver.user_id]?.name_NRIC ||
                          approverUsers[approver.user_id]?.username ||
                          `用户 #${approver.user_id}`}
                      </div>
                      <div className="claim-detail__approver-meta" style={{ fontSize: "11px", color: "var(--x-color-ink-muted)", textAlign: "center" }}>
                        {approverUsers[approver.user_id]?.username
                          ? `@${approverUsers[approver.user_id]?.username}`
                          : `ID ${approver.user_id}`}
                      </div>
                      <div className="claim-detail__approver-action" style={{ ...chipStyle, color: approver.reject ? "var(--x-color-danger)" : "var(--x-color-success)" }}>
                        {approver.reject ? "已拒绝" : "已批准"}
                      </div>
                      <div className="claim-detail__approver-time" style={approverTimeStyle}>
                        {approver.decided_at ? approver.decided_at.replace("T", " ").slice(0, 16) : ""}
                      </div>
                      {approver.user_id === currentUserId ? <div className="claim-detail__approver-me" style={approverMeStyle}>你</div> : null}
                    </button>
                  ))}
                </div>
              </Section>
            </div>
          ) : null}

          {(claim.attachments || []).length ? (
            <div className="claim-detail__section-slot" style={{ flex: "1 1 320px", minWidth: 0 }}>
              <Section title="附件">
                <div className="claim-detail__attachments" style={attachmentGridStyle}>
                  {(claim.attachments || []).map((attachment) => (
                    <AttachmentCard key={`${attachment.file_path}-${attachment.file_name || ""}`} attachment={attachment} />
                  ))}
                </div>
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasAccountPermission || isApprovedByMe ? (
        <div className="claim-detail__footer" style={footerActionsStyle}>
          {hasAccountPermission ? (
            <>
              <button type="button" style={buttonApproveStyle} onClick={onApprove}>
                批准
              </button>
              <button type="button" style={buttonRejectStyle} onClick={onReject}>
                拒绝
              </button>
            </>
          ) : null}

          {isApprovedByMe ? (
            <button
              type="button"
              style={buttonPrimaryStyle}
              onClick={() =>
                window.open(
                  `/api/account/print_payment_voucher/download_payment_voucher/${claim.id}`,
                  "_blank",
                )
              }
            >
              Payment Voucher
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedApprover ? (
        <SignViewerModal approver={selectedApprover} onClose={() => setSelectedApprover(null)} />
      ) : null}
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: ClaimAttachment }) {
  return (
    <button type="button" style={attachmentCardStyle} onClick={() => openPreviewModal(attachment)}>
      <div className="claim-detail__attachment-name" style={attachmentNameStyle}>{attachment.file_name || attachment.file_path}</div>
      <div className="claim-detail__attachment-meta" style={attachmentMetaStyle}>{attachment.mime_type || "点击预览"}</div>
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="claim-detail__row" style={detailRowStyle}>
      <div className="claim-detail__row-label" style={detailLabelStyle}>{label}</div>
      <div className="claim-detail__row-value" style={detailValueStyle}>{value || "-"}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="claim-detail__section" style={sectionStyle}>
      <div className="claim-detail__section-title" style={sectionTitleStyle}>{title}</div>
      {children}
    </section>
  );
}

function SignViewerModal({
  approver,
  onClose,
}: {
  approver: { userId: number; name: string; sign: { strokes?: Array<{ points?: Array<{ x: number; y: number }> }> } | null };
  onClose: () => void;
}) {
  return (
    <div
      className="claim-detail__sign-modal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10020,
        background: "rgba(10, 14, 20, 0.6)",
        display: "grid",
        placeItems: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        className="claim-detail__sign-modal-card"
        style={{
          width: "min(720px, 100%)",
          display: "grid",
          gap: "16px",
          padding: "18px",
          borderRadius: "20px",
          background: "var(--x-color-panel-strong)",
          border: "1px solid var(--x-color-line-soft)",
          boxShadow: "0 20px 50px var(--x-color-shadow-soft)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="claim-detail__sign-modal-header"
          style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}
        >
          <div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--x-color-ink)" }}>{approver.name}</div>
            <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>审批签名预览</div>
          </div>
          <button type="button" style={buttonGhostStyle} onClick={onClose}>
            关闭
          </button>
        </div>

        <div
          className="claim-detail__sign-modal-preview"
          style={{
            minHeight: "260px",
            borderRadius: "18px",
            border: "1px solid var(--x-color-line-soft)",
            background: "linear-gradient(180deg, #fffdf8, #f5efe0)",
            overflow: "hidden",
          }}
        >
          <SignatureSvg sign={approver.sign} />
        </div>
      </div>
    </div>
  );
}

function SignatureSvg({
  sign,
}: {
  sign: { strokes?: Array<{ points?: Array<{ x: number; y: number }> }> } | null;
}) {
  const strokes = Array.isArray(sign?.strokes) ? sign.strokes : [];

  if (!strokes.length) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "260px", color: "var(--x-color-ink-muted)" }}>
        没有签名数据
      </div>
    );
  }

  return (
    <svg viewBox="0 0 1000 320" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {strokes.map((stroke, index) => {
        const points = Array.isArray(stroke?.points) ? stroke.points : [];
        if (!points.length) {
          return null;
        }
        const d = points
          .map((point, pointIndex) => {
            const x = Math.max(0, Math.min(1, Number(point.x) || 0)) * 1000;
            const y = Math.max(0, Math.min(1, Number(point.y) || 0)) * 320;
            return `${pointIndex === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
          })
          .join(" ");

        return (
          <path
            key={`stroke-${index}`}
            d={d}
            fill="none"
            stroke="rgba(22, 28, 36, 0.92)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

function safeMoney(value?: number | string) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0.00";
  }
  return amount.toFixed(2);
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
}

function parseApproverSign(value: unknown) {
  if (!value) {
    return null;
  }
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (parsed && typeof parsed === "object") {
    const candidate = parsed as {
      strokes?: Array<{ points?: Array<{ x: number; y: number }> }>;
      extra?: { strokes?: Array<{ points?: Array<{ x: number; y: number }> }> } | string;
    };

    if (Array.isArray(candidate.strokes)) {
      return candidate;
    }

    if (typeof candidate.extra === "string") {
      try {
        const nested = JSON.parse(candidate.extra) as { strokes?: Array<{ points?: Array<{ x: number; y: number }> }> };
        if (Array.isArray(nested.strokes)) {
          return nested;
        }
      } catch {
        return null;
      }
    }

    if (candidate.extra && typeof candidate.extra === "object" && Array.isArray(candidate.extra.strokes)) {
      return candidate.extra;
    }
  }
  return null;
}

function getClaimStatus(claim: ClaimRecord) {
  const approvers = claim.approver_data || [];
  if (approvers.some((approver) => approver.reject)) {
    return "rejected";
  }
  if (approvers.some((approver) => !approver.reject)) {
    return "approved";
  }
  return "pending";
}

function statusText(status?: string) {
  if (status === "approved") {
    return "已批准";
  }
  if (status === "rejected") {
    return "已拒绝";
  }
  return "待处理";
}
