import { summarizeFee } from "../../form/react/FeePanel";
import { RegistrationWorkbench } from "./RegistrationWorkbench";
import {
  makeEndpoints,
  registrationStatusLabel,
  type WorkbenchConfig,
  type WorkbenchEntry,
} from "./workbenchConfig";

function str(entry: WorkbenchEntry, key: string): string {
  const value = entry[key];
  return value == null ? "" : String(value);
}

function registrationTypeLabel(type: unknown): string {
  return type === "renew" ? "会员续费" : "升级会员";
}

function boolLabel(value: unknown): string {
  if (value == null) return "未填写";
  return value ? "是" : "否";
}

function displayName(entry: WorkbenchEntry): string {
  return (
    str(entry, "user_name") ||
    str(entry, "username") ||
    str(entry, "requested_username") ||
    `申请 #${entry.id}`
  );
}

const membershipConfig: WorkbenchConfig = {
  scope: "membership",
  endpoints: makeEndpoints("/api/user_control/membership"),
  canRead: true,
  canEdit: true,
  detailEyebrowPrefix: "会员申请 #",
  pageTitleFor: displayName,
  detailSubline: (entry) =>
    `${registrationTypeLabel(entry.registration_type)}${entry.submitted_at ? ` · ${entry.submitted_at}` : ""}`,
  emptyListText: "还没有会员申请或续费记录。",
  feesTitle: "会员年龄费率",
  feesSaveLabel: "保存会员费率",
  feesSavedNotice: "会员费率已更新",
  feePanel: {
    addButtonLabel: "添加费率",
    saveButtonLabel: "保存费率",
    emptyText: "还没有费率。可以先加一条所有年龄的通用费用，或直接拆成不同年龄段。",
    imageLabel: "该费率付款二维码 / 付款资料",
    descriptionPlaceholder: "例如：见习青芽年费 / 普通会员年费",
  },
  publicFormPath: "/template/long-open-registration-form",
  paymentPageTitle: "会员付款页",
  listColumns: [
    {
      header: "申请人",
      value: displayName,
      sub: (entry) => {
        const uname = str(entry, "username") || str(entry, "requested_username");
        const role = str(entry, "membership_role");
        return `${uname ? `@${uname}` : `#${entry.id}`}${role ? ` · ${role}` : ""}`;
      },
    },
    { header: "类型", value: (entry) => registrationTypeLabel(entry.registration_type) },
    { header: "手机号码", value: (entry) => str(entry, "phone"), mono: true },
    { header: "适用费用", value: (entry) => (entry.selected_fee ? summarizeFee(entry.selected_fee) : "未匹配费率") },
    { header: "下一次到期", value: (entry) => str(entry, "target_expiry_date"), mono: true },
  ],
  detailFields: [
    { label: "状态", value: (entry) => registrationStatusLabel(entry.status as string) },
    { label: "申请类型", value: (entry) => registrationTypeLabel(entry.registration_type) },
    { label: "NRIC", key: "nric" },
    { label: "Username", value: (entry) => str(entry, "username") || str(entry, "requested_username") },
    { label: "英文名", key: "english_name", editable: true },
    { label: "手机号码", key: "phone", editable: true },
    { label: "性别", key: "gender", editable: true, placeholder: "男 / 女" },
    { label: "加入身份", key: "membership_role", editable: true },
    { label: "下一次到期日", key: "target_expiry_date" },
    { label: "适用费用", value: (entry) => (entry.selected_fee ? summarizeFee(entry.selected_fee) : "未匹配费率") },
    { label: "推荐人", value: (entry) => str(entry, "recommender_name") || "未填写" },
    { label: "籍贯", key: "ancestral_home", editable: true },
    { label: "职业", key: "occupation", editable: true },
    { label: "是否皈依", value: (entry) => boolLabel(entry.refuge_taken) },
    { label: "皈依年份", key: "refuge_year", editable: true },
    { label: "皈依证明法师", key: "refuge_master", editable: true },
    { label: "法名", key: "dharma_name", editable: true },
    { label: "紧急联络人姓名", key: "emergency_contact_name", editable: true },
    { label: "紧急联络人电话", key: "emergency_contact_phone", editable: true },
    { label: "Facebook", key: "facebook_profile_url", editable: true, kind: "link" },
    { label: "住家地址 / NRIC_address", key: "nric_address", editable: true, kind: "multiline" },
  ],
};

export function MembershipRegistrationPage() {
  return <RegistrationWorkbench config={membershipConfig} />;
}
