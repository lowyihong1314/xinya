import { useEffect, useState } from "react";

import type { MemberRenewalRecord, UserRecord } from "../types";
import { Field } from "./shared";
import * as styles from "./styles";
import type { MemberRenewalPayload, UserEditorPayload } from "./types";

function buildEditorForm(user: UserRecord): UserEditorPayload {
  return {
    username: user.username || "",
    display_name: user.display_name || "",
    email: user.email || "",
    phone: user.phone || "",
    name_NRIC: user.name_NRIC || "",
    display: Boolean(user.display),
    is_member: Boolean(user.is_member),
    NRIC: user.NRIC || "",
    gender: user.gender || "",
    parent_1: user.parent_1 || "",
    parent_1_phone: user.parent_1_phone || "",
    medical: user.medical || "",
    allergy: user.allergy || "",
  };
}

export function UserEditorPage({
  user,
  onBack,
  onSave,
  onDelete,
  onResetPassword,
  onCreateRenewal,
  onDeleteRenewal,
}: {
  user: UserRecord;
  onBack: () => void;
  onSave: (payload: UserEditorPayload) => void;
  onDelete: () => void;
  onResetPassword: () => void;
  onCreateRenewal: (payload: MemberRenewalPayload) => void;
  onDeleteRenewal: (renewalId: number) => void;
}) {
  const [form, setForm] = useState<UserEditorPayload>(() => buildEditorForm(user));
  const [renewalForm, setRenewalForm] = useState<{
    renewal_date: string;
    note: string;
    proof: File | null;
  }>({
    renewal_date: "",
    note: "",
    proof: null,
  });

  useEffect(() => {
    setForm(buildEditorForm(user));
  }, [user]);

  return (
    <div style={styles.editorPageStyle}>
      <div style={styles.editorPageHeaderStyle}>
        <div>
          <div style={styles.sectionEyebrowStyle}>User Detail</div>
          <h4 style={styles.editorPageTitleStyle}>
            {form.display_name || form.username || user.id}
          </h4>
          <div style={styles.editorPageMetaStyle}>
            Username · {form.username ? `@${form.username}` : "未设置"}
          </div>
        </div>
        <button
          type="button"
          style={styles.secondaryButtonStyle}
          onClick={onBack}
        >
          返回列表
        </button>
      </div>

      <div style={styles.formGridStyle}>
        <Field
          label="用户名"
          value={form.username}
          onChange={(value) => setForm((prev) => ({ ...prev, username: value }))}
        />
        <Field
          label="显示名称"
          value={form.display_name}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, display_name: value }))
          }
        />
        <Field
          label="邮箱"
          value={form.email}
          onChange={(value) => setForm((prev) => ({ ...prev, email: value }))}
        />
        <Field
          label="电话"
          value={form.phone}
          onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
        />
        <Field
          label="姓名 (NRIC)"
          value={form.name_NRIC}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, name_NRIC: value }))
          }
        />
        <Field
          label="NRIC"
          value={form.NRIC}
          onChange={(value) => setForm((prev) => ({ ...prev, NRIC: value }))}
        />
        <Field
          label="性别"
          value={form.gender}
          onChange={(value) => setForm((prev) => ({ ...prev, gender: value }))}
        />
        <Field
          label="家长 1"
          value={form.parent_1}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, parent_1: value }))
          }
        />
        <Field
          label="家长 1 电话"
          value={form.parent_1_phone}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, parent_1_phone: value }))
          }
        />
        <label style={styles.checkboxRowStyle}>
          <input
            type="checkbox"
            checked={form.display}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, display: event.target.checked }))
            }
          />
          <span>对外显示</span>
        </label>
        <label style={styles.checkboxRowStyle}>
          <input
            type="checkbox"
            checked={form.is_member}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, is_member: event.target.checked }))
            }
          />
          <span>会员</span>
        </label>
        <Field
          label="病史"
          value={form.medical}
          textarea
          onChange={(value) =>
            setForm((prev) => ({ ...prev, medical: value }))
          }
        />
        <Field
          label="过敏"
          value={form.allergy}
          textarea
          onChange={(value) =>
            setForm((prev) => ({ ...prev, allergy: value }))
          }
        />
      </div>

      <div style={styles.renewalSectionStyle}>
        <div style={styles.renewalSectionHeaderStyle}>
          <div style={styles.fieldLabelStyle}>会员续费历史</div>
        </div>

        <div style={styles.renewalFormStyle}>
          <label style={styles.fieldStyle}>
            <span style={styles.fieldLabelStyle}>续费日期</span>
            <input
              type="date"
              style={styles.inputStyle}
              value={renewalForm.renewal_date}
              onChange={(event) =>
                setRenewalForm((prev) => ({
                  ...prev,
                  renewal_date: event.target.value,
                }))
              }
            />
          </label>

          <label style={styles.fieldStyle}>
            <span style={styles.fieldLabelStyle}>备注</span>
            <input
              type="text"
              style={styles.inputStyle}
              value={renewalForm.note}
              onChange={(event) =>
                setRenewalForm((prev) => ({ ...prev, note: event.target.value }))
              }
            />
          </label>

          <label style={styles.fieldStyle}>
            <span style={styles.fieldLabelStyle}>证明</span>
            <input
              type="file"
              style={styles.inputStyle}
              onChange={(event) =>
                setRenewalForm((prev) => ({
                  ...prev,
                  proof: event.target.files?.[0] || null,
                }))
              }
            />
          </label>

          <div style={styles.renewalActionWrapStyle}>
            <button
              type="button"
              style={styles.secondaryButtonStyle}
              onClick={() => {
                onCreateRenewal(renewalForm);
                setRenewalForm({ renewal_date: "", note: "", proof: null });
              }}
            >
              新增续费
            </button>
          </div>
        </div>

        <div style={styles.renewalListStyle}>
          {(user.member_renewals || []).length ? (
            (user.member_renewals || []).map((item) => (
              <RenewalCard
                key={item.id}
                item={item}
                onDelete={() => onDeleteRenewal(item.id)}
              />
            ))
          ) : (
            <div style={styles.placeholderStyle}>还没有续费记录</div>
          )}
        </div>
      </div>

      <div style={styles.modalFooterStyle}>
        <button type="button" style={styles.dangerButtonStyle} onClick={onDelete}>
          删除
        </button>
        <button
          type="button"
          style={styles.secondaryButtonStyle}
          onClick={onResetPassword}
        >
          重置密码
        </button>
        <button
          type="button"
          style={styles.primaryButtonStyle}
          onClick={() => onSave(form)}
        >
          保存
        </button>
      </div>
    </div>
  );
}

function RenewalCard({
  item,
  onDelete,
}: {
  item: MemberRenewalRecord;
  onDelete: () => void;
}) {
  return (
    <div style={styles.renewalCardStyle}>
      <div style={styles.renewalMetaStyle}>
        <div style={styles.renewalDateStyle}>{item.renewal_date || "-"}</div>
        <div style={styles.renewalInfoStyle}>
          {item.created_by_name ? `录入：${item.created_by_name}` : ""}
          {item.note ? `${item.created_by_name ? " · " : ""}${item.note}` : ""}
        </div>
      </div>
      <div style={styles.attachmentActionRowStyle}>
        {item.proof_path ? (
          <button
            type="button"
            style={styles.secondaryButtonStyle}
            onClick={() =>
              window.open(
                `/media_file/${item.proof_path}`,
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            查看证明
          </button>
        ) : null}
        <button
          type="button"
          style={styles.dangerButtonStyle}
          onClick={onDelete}
        >
          删除
        </button>
      </div>
    </div>
  );
}
