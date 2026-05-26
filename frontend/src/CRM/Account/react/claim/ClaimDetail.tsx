import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { CachedImage } from "../../../../components/CachedMedia";
import { apiFetch } from "../../../../js/apiFetch";
import { openPreviewModal } from "../../../../js/attachment_preview";
import { showConfirmDialog } from "../../../../js/dialogs";
import { showEventPicker } from "../../../shared/showEventPicker";
import { deleteClaimAttachment, updateClaim, updateClaimEvent, uploadClaimAttachments } from "./api";
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
  buttonSecondaryStyle,
  buttonRejectStyle,
  detailGridStyle,
  detailLabelStyle,
  detailRowStyle,
  detailValueStyle,
  footerActionsStyle,
  inputStyle,
  panelHeaderStyle,
  panelTitleStyle,
  purposeBoxStyle,
  sectionStyle,
  sectionTitleStyle,
  statusBadgeStyle,
  textareaStyle,
} from "./claimStyles";
import { PaymentVoucherModal } from "./PaymentVoucherModal";
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
}: ClaimDetailProps) {
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
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
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

  return (
    <>
      <div className="claim-detail__header" style={panelHeaderStyle}>
        <button type="button" style={buttonGhostStyle} onClick={onBack}>
          返回列表
        </button>
        <div className="claim-detail__title" style={panelTitleStyle}>申请详情 #{claim.id}</div>
      </div>

      <div className="claim-detail__status-row" style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <div className="claim-detail__status-badge" style={statusBadgeStyle(claimStatus)}>{statusText(claimStatus)}</div>
        <span style={chipStyle}>
          批准 {claim.approver_data?.filter((item) => !item.reject).length || 0} 人
        </span>
        <span style={chipStyle}>
          拒绝 {claim.approver_data?.filter((item) => item.reject).length || 0} 人
        </span>
        {approverLoadError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{approverLoadError}</span> : null}
        {editFeedback ? <span style={{ ...chipStyle, color: "var(--x-color-success)" }}>{editFeedback}</span> : null}
        {editError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{editError}</span> : null}
        {attachmentFeedback ? <span style={{ ...chipStyle, color: "var(--x-color-success)" }}>{attachmentFeedback}</span> : null}
        {attachmentError ? <span style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{attachmentError}</span> : null}
      </div>

      <div className="claim-detail__grid" style={detailGridStyle(isMobile)}>
        {editingClaim ? (
          <EditableDetailRow label="申请人">
            <input
              style={inputStyle}
              value={editDraft.applicant_name}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, applicant_name: event.target.value }))}
            />
          </EditableDetailRow>
        ) : (
          <DetailRow label="申请人" value={claim.applicant_name} />
        )}
        {editingClaim ? (
          <EditableDetailRow label="金额">
            <input
              type="number"
              inputMode="decimal"
              style={inputStyle}
              value={editDraft.amount}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, amount: event.target.value }))}
            />
          </EditableDetailRow>
        ) : (
          <DetailRow label="金额" value={`RM ${safeMoney(claim.amount)}`} />
        )}
        {editingClaim ? (
          <EditableDetailRow label="日期">
            <input
              type="date"
              style={inputStyle}
              value={editDraft.request_date}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, request_date: event.target.value }))}
            />
          </EditableDetailRow>
        ) : (
          <DetailRow label="日期" value={claim.request_date} />
        )}
        {editingClaim ? (
          <EditableDetailRow label="部门">
            <input
              style={inputStyle}
              value={editDraft.department_name}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, department_name: event.target.value }))}
            />
          </EditableDetailRow>
        ) : (
          <DetailRow label="部门" value={claim.department_name || "-"} />
        )}
        {editingClaim ? (
          <EditableDetailRow label="采购日期">
            <input
              type="datetime-local"
              style={inputStyle}
              value={editDraft.purchase_datetime}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, purchase_datetime: event.target.value }))}
            />
          </EditableDetailRow>
        ) : (
          <DetailRow label="采购日期" value={formatDateTime(claim.purchase_datetime)} />
        )}
        <DetailRow label="收款人 / 签收人" value={claim.voucher_recipient_name || "-"} />
        <DetailRow label="签收时间" value={formatDateTime(claim.voucher_signed_at)} />
        <div className="claim-detail__row" style={detailRowStyle}>
          <div className="claim-detail__row-label" style={detailLabelStyle}>活动</div>
          {editingClaim && canEditEvent ? (
            <div style={eventActionRowStyle}>
              <span style={chipStyle}>
                {claim.event_id ? `${claim.event_name || "未命名活动"} (#${claim.event_id})` : "未关联活动"}
              </span>
              <button
                type="button"
                style={disabledStyle(buttonSecondaryStyle, savingEvent)}
                disabled={savingEvent}
                onClick={() => void handlePickEvent()}
              >
                {savingEvent ? "保存中…" : claim.event_id ? "更换活动" : "选择活动"}
              </button>
              {claim.event_id ? (
                <button
                  type="button"
                  style={disabledStyle(buttonGhostStyle, savingEvent)}
                  disabled={savingEvent}
                  onClick={() => void handleClearEvent()}
                >
                  清除
                </button>
              ) : null}
            </div>
          ) : (
            <div className="claim-detail__row-value" style={detailValueStyle}>
              {claim.event_id ? `${claim.event_name || "未命名活动"} (#${claim.event_id})` : "-"}
            </div>
          )}
          {eventFeedback ? <div style={{ ...chipStyle, color: "var(--x-color-success)" }}>{eventFeedback}</div> : null}
          {eventError ? <div style={{ ...chipStyle, color: "var(--x-color-danger)" }}>{eventError}</div> : null}
          {claim.is_locked ? <div style={{ ...chipStyle, color: "var(--x-color-ink-muted)" }}>该申请已锁定，不能修改活动</div> : null}
        </div>
        <DetailRow label="创建时间" value={formatDateTime(claim.created_at)} />
      </div>

      {editingClaim ? (
        <label className="claim-detail__purpose claim-detail__purpose--editing" style={purposeBoxStyle}>
          <span style={detailLabelStyle}>用途说明</span>
          <textarea
            rows={4}
            style={textareaStyle}
            value={editDraft.purpose}
            onChange={(event) => setEditDraft((prev) => ({ ...prev, purpose: event.target.value }))}
          />
        </label>
      ) : claim.purpose ? (
        <div className="claim-detail__purpose" style={purposeBoxStyle}>{claim.purpose}</div>
      ) : null}

      {editingClaim ? (
        <div className="claim-detail__ai-fields" style={{ display: "grid", gap: "8px" }}>
          <label className="claim-detail__purpose claim-detail__purpose--editing" style={purposeBoxStyle}>
            <span style={detailLabelStyle}>AI说明 ref1</span>
            <textarea
              rows={3}
              style={textareaStyle}
              value={editDraft.ref1}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, ref1: event.target.value }))}
            />
          </label>
          <label className="claim-detail__purpose claim-detail__purpose--editing" style={purposeBoxStyle}>
            <span style={detailLabelStyle}>AI项目内容 ref2</span>
            <textarea
              rows={4}
              style={textareaStyle}
              value={editDraft.ref2}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, ref2: event.target.value }))}
            />
          </label>
          <div className="claim-detail__purpose claim-detail__purpose--editing" style={purposeBoxStyle}>
            <span style={detailLabelStyle}>商家资料</span>
            <div style={detailGridStyle(isMobile)}>
              <label style={{ display: "grid", gap: "4px" }}>
                <span style={detailLabelStyle}>商家名称</span>
                <input
                  style={inputStyle}
                  value={editDraft.vendor_name}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, vendor_name: event.target.value }))}
                />
              </label>
              <label style={{ display: "grid", gap: "4px" }}>
                <span style={detailLabelStyle}>商家联络号码</span>
                <input
                  style={inputStyle}
                  value={editDraft.vendor_contact_number}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, vendor_contact_number: event.target.value }))}
                />
              </label>
              <label style={{ display: "grid", gap: "4px", gridColumn: "1 / -1" }}>
                <span style={detailLabelStyle}>商家地址</span>
                <input
                  style={inputStyle}
                  value={editDraft.vendor_address}
                  onChange={(event) => setEditDraft((prev) => ({ ...prev, vendor_address: event.target.value }))}
                />
              </label>
            </div>
          </div>
        </div>
      ) : claim.ref1 || claim.ref2 || claim.vendor_name || claim.vendor_address || claim.vendor_contact_number ? (
        <div className="claim-detail__ai-fields" style={{ display: "grid", gap: "8px" }}>
          {claim.ref1 ? (
            <div className="claim-detail__purpose" style={purposeBoxStyle}>
              <span style={detailLabelStyle}>AI说明 ref1</span>
              <span>{claim.ref1}</span>
            </div>
          ) : null}
          {claim.ref2 ? (
            <div className="claim-detail__purpose" style={purposeBoxStyle}>
              <span style={detailLabelStyle}>AI项目内容 ref2</span>
              <span>{claim.ref2}</span>
            </div>
          ) : null}
          {claim.vendor_name || claim.vendor_address || claim.vendor_contact_number ? (
            <div className="claim-detail__purpose" style={purposeBoxStyle}>
              <span style={detailLabelStyle}>商家资料</span>
              <span style={{ whiteSpace: "pre-wrap" }}>
                {[
                  claim.vendor_name ? `商家名称：${claim.vendor_name}` : "",
                  claim.vendor_contact_number ? `联络号码：${claim.vendor_contact_number}` : "",
                  claim.vendor_address ? `地址：${claim.vendor_address}` : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {claim.approver_data?.length || (claim.attachments || []).length || canEditAttachments || (claim.change_logs || []).length ? (
        <div
          className="claim-detail__section-row"
          style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "stretch" }}
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
                      <CachedImage
                        src={`/api/user_control/get_profile_image/${approver.user_id}`}
                        cacheKey={`claim-approver:${approver.user_id}`}
                        resolveRelativeToApi
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

          {(claim.change_logs || []).length ? (
            <div className="claim-detail__section-slot" style={{ flex: "1 1 320px", minWidth: 0 }}>
              <Section title="修改记录">
                <div style={changeLogListStyle}>
                  {(claim.change_logs || []).slice(0, 12).map((log) => (
                    <ChangeLogCard key={log.id} log={log} />
                  ))}
                </div>
              </Section>
            </div>
          ) : null}

          {(claim.attachments || []).length || canEditAttachments ? (
            <div className="claim-detail__section-slot" style={{ flex: "1 1 320px", minWidth: 0 }}>
              <Section title="附件">
                {canEditAttachments ? (
                  <div style={attachmentActionStyle}>
                    <button
                      type="button"
                      style={disabledStyle(buttonSecondaryStyle, uploadingAttachments)}
                      disabled={uploadingAttachments}
                      onClick={() => attachmentInputRef.current?.click()}
                    >
                      {uploadingAttachments ? "上传中…" : "新增附件"}
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      multiple
                      style={hiddenInputStyle}
                      onChange={(event) => {
                        void handleUploadAttachments(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                ) : null}
                {(claim.attachments || []).length ? (
                  <div className="claim-detail__attachments" style={attachmentGridStyle}>
                    {(claim.attachments || []).map((attachment) => (
                      <AttachmentCard
                        key={`${attachment.file_path}-${attachment.file_name || ""}`}
                        attachment={attachment}
                        canDelete={canEditAttachments}
                        deleting={deletingAttachmentId === attachment.id}
                        onDelete={() => void handleDeleteAttachment(attachment)}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={chipStyle}>还没有附件</div>
                )}
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}

      {canEditClaims || isApprovedByMe ? (
        <div className="claim-detail__footer" style={footerActionsStyle}>
          {canEditClaims ? (
            <>
              {canEditClaim ? (
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
              {editingClaim ? (
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
              <button type="button" style={buttonApproveStyle} onClick={onApprove}>
                批准
              </button>
              <button type="button" style={buttonRejectStyle} onClick={onReject}>
                拒绝
              </button>
              <button type="button" style={buttonRejectStyle} onClick={onDelete}>
                删除申请
              </button>
            </>
          ) : null}

          {isApprovedByMe ? (
            <button
              type="button"
              style={buttonPrimaryStyle}
              onClick={() => setVoucherOpen(true)}
            >
              Payment Voucher
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedApprover ? (
        <SignViewerModal approver={selectedApprover} onClose={() => setSelectedApprover(null)} />
      ) : null}

      {voucherOpen ? <PaymentVoucherModal claimId={claim.id} onClose={() => setVoucherOpen(false)} /> : null}
    </>
  );
}

function AttachmentCard({
  attachment,
  canDelete,
  deleting,
  onDelete,
}: {
  attachment: ClaimAttachment;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
}) {
  const normalizedAttachment = {
    ...attachment,
    file_name: ensureAttachmentDownloadName(attachment),
  };

  return (
    <div style={{ ...attachmentCardStyle, cursor: "default" }}>
      <div className="claim-detail__attachment-name" style={attachmentNameStyle}>{normalizedAttachment.file_name || attachment.file_path}</div>
      <div className="claim-detail__attachment-meta" style={attachmentMetaStyle}>{attachment.mime_type || "点击预览"}</div>
      <div style={attachmentButtonRowStyle}>
        <button type="button" style={smallAttachmentButtonStyle} onClick={() => openPreviewModal(normalizedAttachment)}>
          预览
        </button>
        {canDelete ? (
          <button type="button" style={smallAttachmentDangerButtonStyle} disabled={deleting} onClick={onDelete}>
            {deleting ? "删除中…" : "删除"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

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

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="claim-detail__row" style={detailRowStyle}>
      <div className="claim-detail__row-label" style={detailLabelStyle}>{label}</div>
      <div className="claim-detail__row-value" style={detailValueStyle}>{value || "-"}</div>
    </div>
  );
}

function EditableDetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="claim-detail__row claim-detail__row--editing" style={detailRowStyle}>
      <span className="claim-detail__row-label" style={detailLabelStyle}>{label}</span>
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

const eventActionRowStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap" as const,
  alignItems: "center",
};

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

const attachmentActionStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: "8px",
};

const hiddenInputStyle: CSSProperties = {
  display: "none",
};

const attachmentButtonRowStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
  alignItems: "center",
};

const smallAttachmentButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "6px",
  padding: "6px 8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "12px",
};

const smallAttachmentDangerButtonStyle: CSSProperties = {
  ...smallAttachmentButtonStyle,
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-tint)",
  color: "var(--x-color-danger)",
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
