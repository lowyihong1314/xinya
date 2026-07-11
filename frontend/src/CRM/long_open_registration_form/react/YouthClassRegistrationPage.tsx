import { useMemo } from "react";

import { useUserState } from "../../../app/UserState";
import { getUserPermissionNames } from "../../../app/permissions";
import { apiFetch } from "../../../js/apiFetch";
import { summarizeFee } from "../../form/react/FeePanel";
import { RegistrationWorkbench } from "./RegistrationWorkbench";
import {
  makeEndpoints,
  registrationStatusLabel,
  type WorkbenchConfig,
  type WorkbenchEntry,
} from "./workbenchConfig";

const YOUTH_BASE = "/api/form/youth-class-registration";

async function upgradeYouthToMembership(entryId: number): Promise<{ message?: string }> {
  const response = await apiFetch(`${YOUTH_BASE}/${entryId}/upgrade-to-membership`, {
    method: "POST",
    credentials: "include",
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string; status?: string };
  if (!response.ok || payload.status !== "success") {
    throw new Error(payload.error || payload.message || "升级失败");
  }
  return payload;
}

function str(entry: WorkbenchEntry, key: string): string {
  const value = entry[key];
  return value == null ? "" : String(value);
}

function youthName(entry: WorkbenchEntry): string {
  return str(entry, "chinese_name") || str(entry, "english_name") || `报名 #${entry.id}`;
}

const YOUTH_ENDPOINTS = makeEndpoints(YOUTH_BASE);

export function YouthClassRegistrationPage() {
  const { user } = useUserState();

  const config = useMemo<WorkbenchConfig>(() => {
    const permissions = getUserPermissionNames(user);
    const canRead =
      permissions.has("youth_class_read") ||
      permissions.has("youth_class_edit") ||
      permissions.has("council_approve");
    const canEdit = permissions.has("youth_class_edit");

    return {
      scope: "youth_class",
      endpoints: YOUTH_ENDPOINTS,
      canRead,
      canEdit,
      detailEyebrowPrefix: "青少年报名 #",
      pageTitleFor: youthName,
      detailSubline: (entry) =>
        [str(entry, "age") ? `${str(entry, "age")}岁` : "", str(entry, "category"), entry.submitted_at || ""]
          .filter(Boolean)
          .join(" · "),
      emptyListText: "还没有青少年佛学班报名记录。",
      feesTitle: "青少年报名费率",
      feesSaveLabel: "保存报名费率",
      feesSavedNotice: "报名费率已更新",
      feePanel: {
        addButtonLabel: "添加费率",
        saveButtonLabel: "保存费率",
        emptyText: "还没有费率。可以先加一条通用报名费用，或按年龄段拆分。",
        imageLabel: "该费率付款二维码 / 付款资料",
        descriptionPlaceholder: "例如：青少年佛学班年费",
      },
      publicFormPath: "/template/long-open-registration-form",
      paymentPageTitle: "青少年付款页",
      listColumns: [
        { header: "姓名", value: youthName, sub: (entry) => str(entry, "english_name") },
        {
          header: "年龄 · 组别",
          value: (entry) => `${str(entry, "age") ? `${str(entry, "age")}岁` : "—"} · ${str(entry, "category") || "—"}`,
        },
        { header: "手机号码", value: (entry) => str(entry, "phone"), mono: true },
        { header: "适用费用", value: (entry) => (entry.selected_fee ? summarizeFee(entry.selected_fee) : "未匹配费率") },
      ],
      detailFields: [
        { label: "状态", value: (entry) => registrationStatusLabel(entry.status as string) },
        { label: "NRIC", key: "nric" },
        { label: "年龄", key: "age" },
        { label: "组别", key: "category" },
        { label: "适用费用", value: (entry) => (entry.selected_fee ? summarizeFee(entry.selected_fee) : "未匹配费率") },
        { label: "中文名", key: "chinese_name", editable: true },
        { label: "英文名", key: "english_name", editable: true },
        { label: "手机号码", key: "phone", editable: true },
        { label: "性别", key: "gender", editable: true, placeholder: "男 / 女" },
        { label: "住家地址", key: "address", editable: true },
        { label: "紧急联络人姓名", key: "emergency_contact_name", editable: true },
        { label: "紧急联络人电话", key: "emergency_contact_phone", editable: true },
        { label: "紧急联络人关系", key: "emergency_contact_relation", editable: true },
      ],
      socket: {
        origin: "https://utbabuddha.com",
        room: "youth_class_registration",
        event: "youth_class_registration_update",
        noticeText: "收到新的青少年佛学班付款截图。",
      },
      upgradeToMembership: upgradeYouthToMembership,
    };
  }, [user]);

  return <RegistrationWorkbench config={config} />;
}
