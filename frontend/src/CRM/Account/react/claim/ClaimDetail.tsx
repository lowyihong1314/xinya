import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { CachedImage } from "../../../../components/CachedMedia";
import { apiFetch } from "../../../../js/apiFetch";
import { getAttachmentKind, openPreviewModal, resolveAttachmentPreviewUrl } from "../../../../js/attachment_preview";
import { showConfirmDialog } from "../../../../js/dialogs";
import { showEventPicker } from "../../../shared/showEventPicker";
import { downloadBlobOrShare } from "../../../../js/browserActions";
import { deleteClaimAttachment, downloadPaymentVoucher, updateClaim, updateClaimEvent, uploadClaimAttachments } from "./api";
import {
  approverAvatarStyle,
  approverCardStyle,
  approverMeStyle,
  approverRowStyle,
  approverTimeStyle,
  chipStyle,
  buttonApproveStyle,
  buttonGhostStyle,
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  buttonRejectStyle,
  inputStyle,
  sectionStyle,
  sectionTitleStyle,
  statusBadgeStyle,
  textareaStyle,
} from "./claimStyles";
import { PaymentVoucherModal } from "./PaymentVoucherModal";
import { DocDetailHeader } from "../shared/DocDetailHeader";
import { WriteJEModal } from "../shared/WriteJEModal";
import type { ApproverUserProfile, ClaimAttachment, ClaimChangeLog, ClaimRecord } from "./types";

type ClaimDetailProps = {
  isMobile: boolean;
  claim: ClaimRecord;
  canEditClaims: boolean;
  isApprovedByMe: boolean;
  currentUserId?: number;
  onBack: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onClaimUpdated: (claim: ClaimRecord) => void;
  onPrev?: () => void;
  onNext?: () => void;
  positionLabel?: string;
};

type ClaimEditDraft = {
  applicant_name: string;
  amount: string;
  request_date: string;
  department_name: string;
  purpose: string;
  ref1: string;
  ref2: string;
  vendor_name: string;
  vendor_address: string;
  vendor_contact_number: string;
  purchase_datetime: string;
};

export function ClaimDetail({
  isMobile,
  claim,
  canEditClaims,
  isApprovedByMe,
  currentUserId,
  onBack,
  onApprove,
  onReject,
  onDelete,
  onClaimUpdated,
  onPrev,
  onNext,
  positionLabel,
}: ClaimDetailProps) {
  const [jeOpen, setJeOpen] = useState(false);
  const [downloadingVoucher, setDownloadingVoucher] = useState(false);
  const [approverUsers, setApproverUsers] = useState<Record<number, ApproverUserProfile>>({});
  const [approverLoadError, setApproverLoadError] = useState("");
  const [selectedApprover, setSelectedApprover] = useState<{
    userId: number;
    name: string;
    sign: { strokes?: Array<{ points?: Array<{ x: number; y: number }> }> } | null;
  } | null>(null);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [eventFeedback, setEventFeedback] = useState("");
  const [eventError, setEventError] = useState("");
  const [editingClaim, setEditingClaim] = useState(false);
  const [editDraft, setEditDraft] = useState<ClaimEditDraft>(() => buildEditDraft(claim));
  const [savingClaim, setSavingClaim] = useState(false);
  const [editFeedback, setEditFeedback] = useState("");
  const [editError, setEditError] = useState("");
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null);
  const [attachmentFeedback, setAttachmentFeedback] = useState("");
  const [attachmentError, setAttachmentError] = useState("");
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState(0);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  function goPurchaseInbound() {
    const params = new URLSearchParams({
      asset_panel: "documents",
      doc_from_claim: String(claim.id),
    });
    if (claim.vendor_name) params.set("doc_vendor", claim.vendor_name);
    if (claim.purpose) params.set("doc_note", claim.purpose);
    navigate(`/crm/asset?${params.toString()}`);
  }

  useEffect(() => {
    setSelectedAttachmentIndex(0);
  }, [claim.id]);
  const claimStatus = useMemo(() => getClaimStatus(claim), [claim]);
  const canEditEvent = Boolean(!claim.is_locked && (canEditClaims || claim.applicant_user_id === currentUserId));
  const canEditClaim = Boolean(!claim.is_locked && canEditClaims);
  const canEditAttachments = Boolean(!claim.is_locked && (canEditClaims || claim.applicant_user_id === currentUserId));

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
            const response = await apiFetch(`/api/user_control/get_user_detail/${userId}`, {
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

  useEffect(() => {
    setEventFeedback("");
    setEventError("");
    setSavingEvent(false);
    setEditingClaim(false);
    setEditDraft(buildEditDraft(claim));
    setSavingClaim(false);
    setEditFeedback("");
    setEditError("");
    setUploadingAttachments(false);
    setDeletingAttachmentId(null);
    setAttachmentFeedback("");
    setAttachmentError("");
  }, [claim.id]);

  async function handlePickEvent() {
    if (!canEditEvent || savingEvent) {
      return;
    }

    const selected = await showEventPicker();
    if (!selected || selected.id === claim.event_id) {
      return;
    }

    setSavingEvent(true);
    setEventFeedback("");
    setEventError("");
    try {
      const updated = await updateClaimEvent(claim.id, selected.id);
      onClaimUpdated(updated);
      setEventFeedback(`已关联活动：${updated.event_name || "未命名活动"} #${updated.event_id}`);
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "更新活动失败");
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleClearEvent() {
    if (!canEditEvent || savingEvent || !claim.event_id) {
      return;
    }

    setSavingEvent(true);
    setEventFeedback("");
    setEventError("");
    try {
      const updated = await updateClaimEvent(claim.id, null);
      onClaimUpdated(updated);
      setEventFeedback("已清除关联活动");
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "清除活动失败");
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleSaveClaimEdit() {
    if (!canEditClaim || savingClaim) {
      return;
    }

    setSavingClaim(true);
    setEditFeedback("");
    setEditError("");
    try {
      const updated = await updateClaim(claim.id, {
        applicant_name: editDraft.applicant_name.trim(),
        amount: editDraft.amount,
        request_date: editDraft.request_date,
        department_name: editDraft.department_name.trim(),
        purpose: editDraft.purpose.trim(),
        ref1: editDraft.ref1.trim(),
        ref2: editDraft.ref2.trim(),
        vendor_name: editDraft.vendor_name.trim(),
        vendor_address: editDraft.vendor_address.trim(),
        vendor_contact_number: editDraft.vendor_contact_number.trim(),
        purchase_datetime: editDraft.purchase_datetime,
      });
      onClaimUpdated(updated);
      setEditDraft(buildEditDraft(updated));
      setEditingClaim(false);
      setEditFeedback("申请内容已更新");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "更新申请失败");
    } finally {
      setSavingClaim(false);
    }
  }

  async function handleUploadAttachments(files: FileList | null) {
    if (!canEditAttachments || uploadingAttachments) {
      return;
    }
    const uploadFiles = Array.from(files || []);
    if (!uploadFiles.length) {
      return;
    }

    setUploadingAttachments(true);
    setAttachmentFeedback("");
    setAttachmentError("");
    try {
      const updated = await uploadClaimAttachments(claim.id, uploadFiles);
      onClaimUpdated(updated);
      setAttachmentFeedback(`已上传 ${uploadFiles.length} 个附件`);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "上传附件失败");
    } finally {
      setUploadingAttachments(false);
    }
  }

  async function handleDeleteAttachment(attachment: ClaimAttachment) {
    if (!canEditAttachments || deletingAttachmentId || !attachment.id) {
      return;
    }

    const confirmed = await showConfirmDialog({
      message: `确认删除附件「${attachment.file_name || attachment.file_path}」吗？`,
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setDeletingAttachmentId(attachment.id);
    setAttachmentFeedback("");
    setAttachmentError("");
    try {
      const updated = await deleteClaimAttachment(attachment.id);
      onClaimUpdated(updated);
      setAttachmentFeedback("附件已删除");
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "删除附件失败");
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  const isVoucherSigned = Boolean(claim.voucher_signed_at) || Boolean(claim.voucher_recipient_sign_json);

  function openSign(name: string, signValue: unknown) {
    const sign = parseApproverSign(signValue);
    if (!sign) {
      return;
    }
    setSelectedApprover({ userId: -1, name, sign });
  }

  async function handleDownloadVoucher() {
    setDownloadingVoucher(true);
    try {
      const blob = await downloadPaymentVoucher(claim.id);
      const filename = `PaymentVoucher_${claim.id}.pdf`;
      await downloadBlobOrShare(blob, filename, { isMobile, title: filename, text: `报销 #${claim.id} Payment Voucher` });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "下载 Payment Voucher 失败");
    } finally {
      setDownloadingVoucher(false);
    }
  }

  const attachments = claim.attachments || [];
  const activeAttachmentIndex = attachments.length ? Math.min(selectedAttachmentIndex, attachments.length - 1) : 0;
  const activeAttachment = attachments[activeAttachmentIndex] || null;
  const activePreviewUrl = activeAttachment ? resolveAttachmentPreviewUrl(activeAttachment) : "";
  const activeKind = activeAttachment ? getAttachmentKind(activeAttachment) : "other";

  const headerActions = (
    <>
      {canEditClaims && canEditClaim ? (
        <button
          type="button"
          style={editingClaim ? buttonPrimaryStyle : buttonSecondaryStyle}
          disabled={savingClaim}
          onClick={() => {
            if (editingClaim) {
              void handleSaveClaimEdit();
              return;
            }
            setEditDraft(buildEditDraft(claim));
            setEditFeedback("");
            setEditError("");
            setEditingClaim(true);
          }}
        >
          {editingClaim ? (savingClaim ? "保存中…" : "保存编辑") : "编辑申请"}
        </button>
      ) : null}
      {canEditClaims && editingClaim ? (
        <button
          type="button"
          style={buttonGhostStyle}
          disabled={savingClaim}
          onClick={() => {
            setEditDraft(buildEditDraft(claim));
            setEditError("");
            setEditingClaim(false);
          }}
        >
          取消编辑
        </button>
      ) : null}
      {canEditClaims ? (
        <>
          <button type="button" style={buttonApproveStyle} onClick={onApprove}>批准</button>
          <button type="button" style={buttonRejectStyle} onClick={onReject}>拒绝</button>
          <button type="button" style={buttonRejectStyle} onClick={onDelete}>删除申请</button>
        </>
      ) : null}
      {isApprovedByMe ? (
        <button type="button" style={buttonPrimaryStyle} onClick={() => setVoucherOpen(true)}>Payment Voucher</button>
      ) : null}
      {isVoucherSigned ? (
        <button type="button" style={buttonSecondaryStyle} onClick={() => void handleDownloadVoucher()} disabled={downloadingVoucher}>
          {downloadingVoucher ? "下载中…" : "下载 Voucher"}
        </button>
      ) : null}
      <button type="button" style={buttonSecondaryStyle} onClick={() => setJeOpen(true)}>写 JE</button>
      <button type="button" style={buttonSecondaryStyle} onClick={goPurchaseInbound}>采购入库</button>
    </>
  );

  return (
    <div style={detailPageStyle}>
      <section style={detailPanelStyle}>
      <DocDetailHeader
        eyebrow="财务 / 报销申请"
        title={`申请详情 #${claim.id}`}
        subtitle={`${claim.applicant_name || "未填姓名"} · RM ${Number(claim.amount ?? 0).toFixed(2)}${claim.department_name ? ` · ${claim.department_name}` : ""}`}
        onBack={onBack}
        onPrev={onPrev}
        onNext={onNext}
        positionLabel={positionLabel}
        actions={headerActions}
      />

      <div style={detailBodyStyle}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={statusBadgeStyle(claimStatus)}>{statusText(claimStatus)}</div>
          <span style={chipStyle}>批准 {claim.approver_data?.filter((item) => !item.reject).length || 0} 人</span>
          <span style={chipStyle}>拒绝 {claim.approver_data?.filter((item) => item.reject).length || 0} 人</span>
          {approverLoadError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{approverLoadError}</span> : null}
          {editFeedback ? <span style={{ ...chipStyle, color: "var(--x-color-success)" }}>{editFeedback}</span> : null}
          {editError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{editError}</span> : null}
          {attachmentFeedback ? <span style={{ ...chipStyle, color: "var(--x-color-success)" }}>{attachmentFeedback}</span> : null}
          {attachmentError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{attachmentError}</span> : null}
        </div>

        <div style={twoColStyle(isMobile)}>
          <div style={infoColStyle}>
            <div style={fieldsGridStyle}>
              <Field label="申请人">
                {editingClaim ? (
                  <input style={inputStyle} value={editDraft.applicant_name} onChange={(e) => setEditDraft((p) => ({ ...p, applicant_name: e.target.value }))} />
                ) : (
                  <FieldValue value={claim.applicant_name} onClick={parseApproverSign(claim.sign_json_data) ? () => openSign(claim.applicant_name || "申请人", claim.sign_json_data) : undefined} />
                )}
              </Field>
              <Field label="金额">
                {editingClaim ? (
                  <input type="number" inputMode="decimal" style={inputStyle} value={editDraft.amount} onChange={(e) => setEditDraft((p) => ({ ...p, amount: e.target.value }))} />
                ) : (
                  <FieldValue value={`RM ${safeMoney(claim.amount)}`} />
                )}
              </Field>
              <Field label="日期">
                {editingClaim ? (
                  <input type="date" style={inputStyle} value={editDraft.request_date} onChange={(e) => setEditDraft((p) => ({ ...p, request_date: e.target.value }))} />
                ) : (
                  <FieldValue value={claim.request_date} />
                )}
              </Field>
              <Field label="部门">
                {editingClaim ? (
                  <input style={inputStyle} value={editDraft.department_name} onChange={(e) => setEditDraft((p) => ({ ...p, department_name: e.target.value }))} />
                ) : (
                  <FieldValue value={claim.department_name || "-"} />
                )}
              </Field>
              <Field label="采购日期">
                {editingClaim ? (
                  <input type="datetime-local" style={inputStyle} value={editDraft.purchase_datetime} onChange={(e) => setEditDraft((p) => ({ ...p, purchase_datetime: e.target.value }))} />
                ) : (
                  <FieldValue value={formatDateTime(claim.purchase_datetime)} />
                )}
              </Field>
              <Field label="收款人 / 签收人">
                <FieldValue value={claim.voucher_recipient_name || "-"} onClick={parseApproverSign(claim.voucher_recipient_sign_json) ? () => openSign(claim.voucher_recipient_name || "收款人", claim.voucher_recipient_sign_json) : undefined} />
              </Field>
              <Field label="签收时间">
                <FieldValue value={formatDateTime(claim.voucher_signed_at)} />
              </Field>
              <Field label="创建时间">
                <FieldValue value={formatDateTime(claim.created_at)} />
              </Field>
            </div>

            <Field label="活动">
              {editingClaim && canEditEvent ? (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={chipStyle}>{claim.event_id ? `${claim.event_name || "未命名活动"} (#${claim.event_id})` : "未关联活动"}</span>
                  <button type="button" style={disabledStyle(buttonSecondaryStyle, savingEvent)} disabled={savingEvent} onClick={() => void handlePickEvent()}>
                    {savingEvent ? "保存中…" : claim.event_id ? "更换活动" : "选择活动"}
                  </button>
                  {claim.event_id ? (
                    <button type="button" style={disabledStyle(buttonGhostStyle, savingEvent)} disabled={savingEvent} onClick={() => void handleClearEvent()}>清除</button>
                  ) : null}
                </div>
              ) : (
                <FieldValue value={claim.event_id ? `${claim.event_name || "未命名活动"} (#${claim.event_id})` : "-"} />
              )}
              {eventFeedback ? <span style={{ ...chipStyle, color: "var(--x-color-success)" }}>{eventFeedback}</span> : null}
              {eventError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{eventError}</span> : null}
            </Field>

            {claim.event_budget_id ? (
              <Field label="关联预算行">
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ ...chipStyle, background: "var(--x-color-accent-tint)", color: "var(--x-color-accent-strong)" }}>
                    预算 · {claim.event_budget_category || `#${claim.event_budget_id}`}
                  </span>
                  {claim.event_id ? (
                    <button type="button" style={buttonSecondaryStyle} onClick={() => navigate(`/crm/event_table?event_id=${claim.event_id}&event_tab=budget`)}>
                      查看预算
                    </button>
                  ) : null}
                </div>
              </Field>
            ) : null}

            <Field label="用途说明">
              {editingClaim ? (
                <textarea rows={3} style={textareaStyle} value={editDraft.purpose} onChange={(e) => setEditDraft((p) => ({ ...p, purpose: e.target.value }))} />
              ) : (
                <FieldValue value={claim.purpose || "-"} multiline />
              )}
            </Field>

            {editingClaim ? (
              <>
                <Field label="AI说明 ref1">
                  <textarea rows={2} style={textareaStyle} value={editDraft.ref1} onChange={(e) => setEditDraft((p) => ({ ...p, ref1: e.target.value }))} />
                </Field>
                <Field label="AI项目内容 ref2">
                  <textarea rows={3} style={textareaStyle} value={editDraft.ref2} onChange={(e) => setEditDraft((p) => ({ ...p, ref2: e.target.value }))} />
                </Field>
                <div style={fieldsGridStyle}>
                  <Field label="商家名称"><input style={inputStyle} value={editDraft.vendor_name} onChange={(e) => setEditDraft((p) => ({ ...p, vendor_name: e.target.value }))} /></Field>
                  <Field label="商家联络号码"><input style={inputStyle} value={editDraft.vendor_contact_number} onChange={(e) => setEditDraft((p) => ({ ...p, vendor_contact_number: e.target.value }))} /></Field>
                  <Field label="商家地址"><input style={inputStyle} value={editDraft.vendor_address} onChange={(e) => setEditDraft((p) => ({ ...p, vendor_address: e.target.value }))} /></Field>
                </div>
              </>
            ) : (
              <>
                {claim.ref1 ? (<Field label="AI说明 ref1"><FieldValue value={claim.ref1} multiline /></Field>) : null}
                {claim.ref2 ? (<Field label="AI项目内容 ref2"><FieldValue value={claim.ref2} multiline /></Field>) : null}
                {claim.vendor_name || claim.vendor_address || claim.vendor_contact_number ? (
                  <Field label="商家资料">
                    <FieldValue multiline value={[claim.vendor_name ? `商家名称：${claim.vendor_name}` : "", claim.vendor_contact_number ? `联络号码：${claim.vendor_contact_number}` : "", claim.vendor_address ? `地址：${claim.vendor_address}` : ""].filter(Boolean).join("\n")} />
                  </Field>
                ) : null}
              </>
            )}
          </div>

          <div style={attachmentColStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={fieldLabelStyle}>附件（{attachments.length}）</span>
              {canEditAttachments ? (
                <>
                  <button type="button" style={disabledStyle(buttonSecondaryStyle, uploadingAttachments)} disabled={uploadingAttachments} onClick={() => attachmentInputRef.current?.click()}>
                    {uploadingAttachments ? "上传中…" : "新增附件"}
                  </button>
                  <input ref={attachmentInputRef} type="file" multiple style={hiddenInputStyle} onChange={(e) => { void handleUploadAttachments(e.target.files); e.target.value = ""; }} />
                </>
              ) : null}
            </div>

            {activeAttachment ? (
              <>
                {attachments.length > 1 ? (
                  <div style={attachmentTabsStyle}>
                    {attachments.map((att, index) => (
                      <button
                        key={`${att.file_path}-${att.file_name || ""}-${index}`}
                        type="button"
                        style={index === activeAttachmentIndex ? attachmentTabActiveStyle : attachmentTabStyle}
                        onClick={() => setSelectedAttachmentIndex(index)}
                      >
                        {att.file_name || att.file_path || `附件 ${index + 1}`}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div style={previewFrameStyle}>
                  {activeKind === "image" ? (
                    <img src={activePreviewUrl} alt="" style={previewMediaStyle} />
                  ) : activeKind === "pdf" ? (
                    <iframe title="attachment-preview" src={activePreviewUrl} style={previewIframeStyle} />
                  ) : (
                    <div style={previewFallbackStyle}>
                      <span>此类型无法内嵌预览。</span>
                      <button type="button" style={buttonSecondaryStyle} onClick={() => openPreviewModal({ ...activeAttachment, file_name: ensureAttachmentDownloadName(activeAttachment) })}>打开预览</button>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ ...chipStyle, color: "var(--x-color-ink-muted)" }}>{activeAttachment.file_name || activeAttachment.file_path}</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button type="button" style={buttonGhostStyle} onClick={() => openPreviewModal({ ...activeAttachment, file_name: ensureAttachmentDownloadName(activeAttachment) })}>大图预览</button>
                    {canEditAttachments ? (
                      <button type="button" style={disabledStyle(buttonRejectStyle, deletingAttachmentId === activeAttachment.id)} disabled={deletingAttachmentId === activeAttachment.id} onClick={() => void handleDeleteAttachment(activeAttachment)}>
                        {deletingAttachmentId === activeAttachment.id ? "删除中…" : "删除附件"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div style={previewFallbackStyle}>还没有附件</div>
            )}
          </div>
        </div>

        {claim.approver_data?.length ? (
          <Section title="审批状态">
            <div className="claim-detail__approvers" style={approverRowStyle}>
              {claim.approver_data.map((approver) => (
                <button
                  type="button"
                  className="claim-detail__approver-card"
                  key={`${approver.user_id}-${approver.decided_at || ""}`}
                  style={{ ...approverCardStyle, cursor: parseApproverSign(approver.sign_json_data) ? "pointer" : "default", textAlign: "center" }}
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
                  <CachedImage
                    src={`/api/user_control/get_profile_image/${approver.user_id}`}
                    cacheKey={`claim-approver:${approver.user_id}`}
                    resolveRelativeToApi
                    alt=""
                    style={approverAvatarStyle(approver.reject)}
                  />
                  <div style={{ fontSize: "13px", fontWeight: 700, textAlign: "center" }}>
                    {approverUsers[approver.user_id]?.display_name ||
                      approverUsers[approver.user_id]?.name_NRIC ||
                      approverUsers[approver.user_id]?.username ||
                      `用户 #${approver.user_id}`}
                  </div>
                  <div style={{ ...chipStyle, color: approver.reject ? "var(--x-color-danger)" : "var(--x-color-success)" }}>
                    {approver.reject ? "已拒绝" : "已批准"}
                  </div>
                  <div style={approverTimeStyle}>{approver.decided_at ? approver.decided_at.replace("T", " ").slice(0, 16) : ""}</div>
                  {approver.user_id === currentUserId ? <div style={approverMeStyle}>你</div> : null}
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        {(claim.change_logs || []).length ? (
          <Section title="修改记录">
            <div style={changeLogListStyle}>
              {(claim.change_logs || []).slice(0, 12).map((log) => (<ChangeLogCard key={log.id} log={log} />))}
            </div>
          </Section>
        ) : null}
      </div>
      </section>

      {selectedApprover ? (
        <SignViewerModal approver={selectedApprover} onClose={() => setSelectedApprover(null)} />
      ) : null}

      {voucherOpen ? <PaymentVoucherModal claimId={claim.id} onClose={() => setVoucherOpen(false)} /> : null}

      <WriteJEModal
        open={jeOpen}
        onClose={() => setJeOpen(false)}
        source="reimbursement"
        sourceRefType="reimbursement_request"
        sourceId={claim.id}
        direction="expense"
        defaultAmount={Number(claim.amount ?? 0)}
        defaultDate={claim.request_date}
        defaultMemo={`报销 #${claim.id}${claim.purpose ? ` · ${claim.purpose}` : ""}`}
        canEdit={canEditClaims}
      />
    </div>
  );
}

const detailPageStyle: CSSProperties = { display: "grid", gap: "10px" };
const detailPanelStyle: CSSProperties = {
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 1px 2px var(--x-color-shadow-soft)",
  overflow: "hidden",
};
const detailBodyStyle: CSSProperties = { display: "grid", gap: "12px", padding: "14px 16px" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function FieldValue({ value, onClick, multiline }: { value?: string | null; onClick?: () => void; multiline?: boolean }) {
  const text = value == null || value === "" ? "-" : value;
  return (
    <div
      style={{
        ...fieldValueStyle,
        ...(multiline ? { whiteSpace: "pre-wrap" } : {}),
        ...(onClick ? { cursor: "pointer", color: "var(--x-color-accent-strong)", fontWeight: 700, width: "fit-content" } : {}),
      }}
      onClick={onClick}
    >
      {text}
    </div>
  );
}

function twoColStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1.15fr)",
    gap: "14px",
    alignItems: "start",
  };
}
const infoColStyle: CSSProperties = { display: "grid", gap: "10px", minWidth: 0 };
const attachmentColStyle: CSSProperties = { display: "grid", gap: "8px", minWidth: 0 };
const fieldsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px 14px" };
const fieldStyle: CSSProperties = { display: "grid", gap: "2px", minWidth: 0 };
const fieldLabelStyle: CSSProperties = { fontSize: "11px", fontWeight: 700, color: "var(--x-color-ink-muted)", letterSpacing: "0.02em" };
const fieldValueStyle: CSSProperties = { fontSize: "13px", color: "var(--x-color-ink)", lineHeight: 1.5, wordBreak: "break-word" };
const previewFrameStyle: CSSProperties = {
  width: "100%",
  height: "min(68vh, 560px)",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const previewMediaStyle: CSSProperties = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" };
const previewIframeStyle: CSSProperties = { width: "100%", height: "100%", border: "none", background: "var(--x-color-panel)" };
const previewFallbackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  justifyItems: "center",
  alignContent: "center",
  padding: "24px",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  textAlign: "center",
  width: "100%",
  height: "100%",
};
const attachmentTabsStyle: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const attachmentTabStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  maxWidth: "180px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const attachmentTabActiveStyle: CSSProperties = {
  ...attachmentTabStyle,
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
};

function ChangeLogCard({ log }: { log: ClaimChangeLog }) {
  return (
    <div style={changeLogCardStyle}>
      <div style={changeLogHeaderStyle}>
        <span>{log.field_name || "字段"}</span>
        <span>{formatDateTime(log.created_at)}</span>
      </div>
      <div style={changeLogMetaStyle}>
        {log.changed_by_name || (log.changed_by_user_id ? `用户 #${log.changed_by_user_id}` : "系统")}
      </div>
      <div style={changeLogValueStyle}>
        <span>{formatLogValue(log.old_value)}</span>
        <span style={changeLogArrowStyle}>-&gt;</span>
        <span>{formatLogValue(log.new_value)}</span>
      </div>
    </div>
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

function buildEditDraft(claim: ClaimRecord): ClaimEditDraft {
  return {
    applicant_name: claim.applicant_name || "",
    amount: claim.amount == null ? "" : String(claim.amount),
    request_date: claim.request_date || "",
    department_name: claim.department_name || "",
    purpose: claim.purpose || "",
    ref1: claim.ref1 || "",
    ref2: claim.ref2 || "",
    vendor_name: claim.vendor_name || "",
    vendor_address: claim.vendor_address || "",
    vendor_contact_number: claim.vendor_contact_number || "",
    purchase_datetime: toDateTimeLocalValue(claim.purchase_datetime),
  };
}

function toDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

const hiddenInputStyle: CSSProperties = {
  display: "none",
};

const changeLogListStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const changeLogCardStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "8px 10px",
  borderRadius: "6px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-alt)",
};

const changeLogHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  color: "var(--x-color-ink)",
  fontSize: "13px",
  fontWeight: 800,
};

const changeLogMetaStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
};

const changeLogValueStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
  gap: "8px",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  lineHeight: 1.5,
  wordBreak: "break-word",
};

const changeLogArrowStyle: CSSProperties = {
  color: "var(--x-color-accent)",
  fontWeight: 900,
};

function formatLogValue(value?: string | null) {
  const normalized = String(value || "").trim();
  return normalized || "-";
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
        padding: "12px",
      }}
      onClick={onClose}
    >
      <div
        className="claim-detail__sign-modal-card"
        style={{
          width: "min(720px, 100%)",
          display: "grid",
          gap: "10px",
          padding: "12px",
          borderRadius: "8px",
          background: "var(--x-color-panel-strong)",
          border: "1px solid var(--x-color-line-soft)",
          boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
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
            minHeight: "220px",
            borderRadius: "6px",
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

function formatDateTime(value?: string | null) {
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

function ensureAttachmentDownloadName(attachment: ClaimAttachment) {
  const fileName = (attachment.file_name || "").trim();
  const pathName = (attachment.file_path || "").split("/").pop() || "";
  const fallbackName = fileName || pathName || "attachment";

  if (hasFileExtension(fallbackName)) {
    return fallbackName;
  }

  const extension = getAttachmentExtension(attachment.mime_type, pathName);
  return extension ? `${fallbackName}${extension}` : fallbackName;
}

function hasFileExtension(value: string) {
  const lastSegment = value.split(/[\\/]/).pop() || "";
  const dotIndex = lastSegment.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < lastSegment.length - 1;
}

function getAttachmentExtension(mimeType?: string, fallbackName?: string) {
  const normalizedMime = (mimeType || "").toLowerCase();
  const normalizedFallback = (fallbackName || "").toLowerCase();

  if (normalizedMime.includes("pdf")) {
    return ".pdf";
  }
  if (normalizedMime.includes("png")) {
    return ".png";
  }
  if (normalizedMime.includes("jpeg") || normalizedMime.includes("jpg")) {
    return ".jpg";
  }
  if (normalizedMime.includes("webp")) {
    return ".webp";
  }
  if (normalizedMime.includes("gif")) {
    return ".gif";
  }
  if (normalizedMime.includes("bmp")) {
    return ".bmp";
  }
  if (normalizedMime.includes("heic")) {
    return ".heic";
  }
  if (normalizedMime.includes("heif")) {
    return ".heif";
  }

  const dotIndex = normalizedFallback.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < normalizedFallback.length - 1) {
    return normalizedFallback.slice(dotIndex);
  }

  return "";
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
