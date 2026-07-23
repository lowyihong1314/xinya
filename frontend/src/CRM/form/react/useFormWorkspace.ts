import { useEffect, useState } from "react";
import { startTransition } from "react";

import { open_parental_form } from "../../../../../static/js/form/parental/modal.js";
import { showConfirmDialog } from "../../../js/dialogs";
import { useDebouncedAutosave } from "../../shared/useDebouncedAutosave";
import { showEventPicker } from "../../shared/showEventPicker";
import { showRegisterDetail } from "./showRegisterDetail";
import {
  addEventToForm,
  addExtraField,
  addFee,
  aiGroupChat,
  applyGroupPlan,
  assignMemberGroup,
  createForm,
  createGroup,
  deleteExtraField,
  deleteFee,
  deleteGroup,
  editMemberField,
  editExtraField,
  editFee,
  editForm,
  fetchFormDetail,
  fetchForms,
  listExtraFields,
  listFees,
  listGroups,
  removeEventFromForm,
  removeForm,
  removeMemberFromForm,
  renameGroup,
} from "./api";
import type { ExtraFieldConfig, FormCreatePayload, FormFee, FormFieldSwitches, FormGroup, FormMember, FormRecord, GroupChatMessage, GroupPlan } from "./types";
import { useFormRealtime } from "./useFormRealtime";

type Toast = { type: "success" | "error"; text: string } | null;
const SUMMARY_SAVE_DEBOUNCE_MS = 600;

function normalizeFieldSwitches(form: FormRecord | null): FormRecord | null {
  if (!form) {
    return null;
  }

  const fieldSwitches: FormFieldSwitches = {
    email: form.field_switches?.email ?? Boolean(form.email),
    parental_form: form.field_switches?.parental_form ?? Boolean(form.parental_form),
    parent_1: form.field_switches?.parent_1 ?? Boolean(form.parent_1),
    parent_2: form.field_switches?.parent_2 ?? Boolean(form.parent_2),
    parent_1_phone: form.field_switches?.parent_1_phone ?? Boolean(form.parent_1_phone),
    parent_2_phone: form.field_switches?.parent_2_phone ?? Boolean(form.parent_2_phone),
    address: form.field_switches?.address ?? Boolean(form.address),
    medical: form.field_switches?.medical ?? Boolean(form.medical),
    allergy: form.field_switches?.allergy ?? Boolean(form.allergy),
    other_remark: form.field_switches?.other_remark ?? Boolean(form.other_remark),
  };

  return {
    ...form,
    field_switches: fieldSwitches,
    ...fieldSwitches,
  };
}

function mergeFormPatch(form: FormRecord, patch: Partial<FormRecord>) {
  return normalizeFieldSwitches({
    ...form,
    ...patch,
    field_switches: {
      ...(form.field_switches || {}),
      ...patch.field_switches,
    },
  } as FormRecord) as FormRecord;
}

export function useFormWorkspace(options?: {
  enabled?: boolean;
  canEditMembers?: boolean;
  canManagePayments?: boolean;
  canConfirmPayments?: boolean;
  preferredFormId?: number | null;
  realtime?: boolean;
}) {
  const enabled = options?.enabled ?? true;
  const canEditMembers = options?.canEditMembers ?? true;
  const canManagePayments = options?.canManagePayments ?? false;
  const canConfirmPayments = options?.canConfirmPayments ?? false;
  const preferredFormId = options?.preferredFormId ?? null;
  const realtime = options?.realtime ?? false;
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [selectedForm, setSelectedForm] = useState<FormRecord | null>(null);
  const [fees, setFees] = useState<FormFee[]>([]);
  const [extraFields, setExtraFields] = useState<ExtraFieldConfig[]>([]);
  const [groups, setGroups] = useState<FormGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);

  const autosave = useDebouncedAutosave<number, Partial<FormRecord>>({
    debounceMs: SUMMARY_SAVE_DEBOUNCE_MS,
    mergePatch: (current, next) => ({
      ...current,
      ...next,
      field_switches: {
        ...(current.field_switches || {}),
        ...(next.field_switches || {}),
      },
    }),
    persist: async (formId, patch) => {
      await editForm(formId, patch);
      setToast({ type: "success", text: "表单信息已更新" });
    },
    onError: (error) => {
      setToast({ type: "error", text: getErrorMessage(error, "更新表单信息失败") });
    },
  });

  // Load the forms list once (independent of which form is open).
  useEffect(() => {
    if (!enabled) {
      autosave.clearPending();
      setForms([]);
      setSelectedFormId(null);
      setSelectedForm(null);
      setFees([]);
      setExtraFields([]);
      setGroups([]);
      setLoading(false);
      setDetailLoading(false);
      return;
    }

    void loadForms();
  }, [enabled]);

  // Selection is driven by the URL (?form_id=): open on change, clear when absent.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (preferredFormId) {
      void openForm(preferredFormId);
    } else {
      setSelectedFormId(null);
      setSelectedForm(null);
      setFees([]);
      setExtraFields([]);
      setGroups([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, preferredFormId]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useFormRealtime({
    enabled: enabled && (realtime || realtimeEnabled),
    formId: selectedFormId,
    onRefresh: () => {
      void refreshSelectedForm();
    },
  });

  function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }

  function applyLocalFormPatch(formId: number, patch: Partial<FormRecord>) {
    setSelectedForm((prev) => {
      if (!prev || prev.id !== formId) {
        return prev;
      }
      return mergeFormPatch(prev, patch);
    });
    setForms((prev) =>
      prev.map((item) => {
        if (item.id !== formId) {
          return item;
        }
        return mergeFormPatch(item, patch);
      }),
    );
  }

  async function loadForms() {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await autosave.flush();
      const payload = await fetchForms();
      const nextForms = Array.isArray(payload.forms) ? payload.forms : [];
      setForms(nextForms.map((form) => normalizeFieldSwitches(form) as FormRecord));
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取报名表失败" });
    } finally {
      setLoading(false);
    }
  }

  async function openForm(formId: number, existingForms = forms) {
    if (!enabled) {
      return;
    }

    if (selectedFormId && selectedFormId !== formId) {
      await autosave.flush();
    }

    setSelectedFormId(formId);
    setDetailLoading(true);
    try {
      const [detailPayload, feesPayload, extraPayload, groupsPayload] = await Promise.all([
        fetchFormDetail(formId),
        listFees(formId),
        listExtraFields(formId),
        listGroups(formId),
      ]);
      const detail =
        "form" in detailPayload ? detailPayload.form || null : (detailPayload as FormRecord);
      const fallback = existingForms.find((item) => item.id === formId) || null;
      const merged = normalizeFieldSwitches({
        ...fallback,
        ...detail,
      } as FormRecord);
      setSelectedForm(merged);
      setFees(Array.isArray(feesPayload) ? feesPayload : feesPayload.fees || []);
      setExtraFields(Array.isArray(extraPayload) ? extraPayload : extraPayload.fields || []);
      setGroups(Array.isArray(groupsPayload) ? groupsPayload : groupsPayload.groups || []);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取表单详情失败" });
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelectedForm() {
    if (!selectedFormId) {
      return;
    }
    await autosave.flush();
    await openForm(selectedFormId);
    await loadForms();
  }

  async function handleCreateForm(payload: FormCreatePayload) {
    try {
      await createForm(payload);
      setCreateOpen(false);
      await loadForms();
      setToast({ type: "success", text: "报名表已创建" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "创建报名表失败") });
    }
  }

  async function handleDeleteForm(formId: number): Promise<boolean> {
    if (!(await showConfirmDialog({ message: "确认删除这个报名表？", tone: "danger" }))) {
      return false;
    }
    try {
      autosave.clearPending(formId);
      await removeForm(formId);
      setForms((prev) => prev.filter((item) => item.id !== formId));
      setSelectedFormId(null);
      setSelectedForm(null);
      setFees([]);
      setExtraFields([]);
      setGroups([]);
      setToast({ type: "success", text: "报名表已删除" });
      return true;
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "删除报名表失败") });
      return false;
    }
  }

  async function patchSelectedForm(patch: Partial<FormRecord>) {
    if (!selectedFormId) {
      return;
    }
    applyLocalFormPatch(selectedFormId, patch);
    autosave.schedule(selectedFormId, patch);
  }

  async function handleAddFee(payload: {
    category: string;
    amount: string;
    age_range_from?: string;
    age_range_to?: string;
    description?: string;
    image_path?: string | null;
  }) {
    if (!selectedFormId) return;
    try {
      await addFee(selectedFormId, payload);
      await refreshSelectedForm();
      setToast({ type: "success", text: "费用已添加" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "添加费用失败") });
    }
  }

  async function handleEditFee(
    feeId: number,
    payload: {
      category: string;
      amount: string;
      age_range_from?: string;
      age_range_to?: string;
      description?: string;
      image_path?: string | null;
    },
  ) {
    try {
      await editFee(feeId, payload);
      await refreshSelectedForm();
      setToast({ type: "success", text: "费用已更新" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "更新费用失败") });
    }
  }

  async function handleDeleteFee(feeId: number) {
    try {
      await deleteFee(feeId);
      await refreshSelectedForm();
      setToast({ type: "success", text: "费用已删除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "删除费用失败") });
    }
  }

  async function handleAddExtraField(payload: {
    label: string;
    field_type: string;
    options?: string[] | null;
    order?: number | null;
  }) {
    if (!selectedFormId) return;
    try {
      await addExtraField(selectedFormId, payload);
      await refreshSelectedForm();
      setToast({ type: "success", text: "表格内容已添加" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "添加表格内容失败") });
    }
  }

  async function handleEditExtraField(
    fieldId: number,
    payload: { label: string; field_type: string; options?: string[] | null; order?: number | null },
  ) {
    try {
      await editExtraField(fieldId, payload);
      await refreshSelectedForm();
      setToast({ type: "success", text: "表格内容已更新" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "更新表格内容失败") });
    }
  }

  async function handleDeleteExtraField(fieldId: number) {
    try {
      await deleteExtraField(fieldId);
      await refreshSelectedForm();
      setToast({ type: "success", text: "表格内容已删除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "删除表格内容失败") });
    }
  }

  async function handlePickEvent() {
    if (!selectedFormId) return;
    try {
      const selected = await showEventPicker();
      if (!selected) return;
      await addEventToForm(selectedFormId, selected.id);
      await refreshSelectedForm();
      setToast({ type: "success", text: "已关联活动" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "关联活动失败") });
    }
  }

  async function handleRemoveEvent(eventId: number) {
    if (!selectedFormId) return;
    try {
      await removeEventFromForm(selectedFormId, eventId);
      await refreshSelectedForm();
      setToast({ type: "success", text: "已移除活动" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "移除活动失败") });
    }
  }

  async function handleRemoveMember(memberId: number) {
    if (!selectedFormId) return;
    if (!(await showConfirmDialog({ message: "确认移出这个成员？", tone: "danger" }))) return;
    try {
      await removeMemberFromForm(selectedFormId, memberId);
      await refreshSelectedForm();
      setToast({ type: "success", text: "成员已移除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "移除成员失败") });
    }
  }

  function setMembersGroupLocal(updater: (member: FormMember) => number | null | undefined) {
    setSelectedForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        members: (prev.members || []).map((m) => ({ ...m, group_id: updater(m) })),
      };
    });
  }

  async function handleCreateGroup(name: string) {
    if (!selectedFormId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createGroup(selectedFormId, trimmed);
      const payload = await listGroups(selectedFormId);
      setGroups(Array.isArray(payload) ? payload : payload.groups || []);
      setToast({ type: "success", text: "小组已创建" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "创建小组失败") });
    }
  }

  async function handleRenameGroup(groupId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await renameGroup(groupId, trimmed);
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)));
      setToast({ type: "success", text: "小组已重命名" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "重命名小组失败") });
    }
  }

  async function handleDeleteGroup(groupId: number) {
    if (!(await showConfirmDialog({ message: "删除这个小组？组内成员会变回未分组。", tone: "danger" }))) return;
    try {
      await deleteGroup(groupId);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setMembersGroupLocal((m) => (m.group_id === groupId ? null : m.group_id ?? null));
      setToast({ type: "success", text: "小组已删除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "删除小组失败") });
    }
  }

  async function handleAiChat(messages: GroupChatMessage[]) {
    if (!selectedFormId) throw new Error("未选择表单");
    return aiGroupChat(selectedFormId, messages);
  }

  async function handleApplyAiPlan(plan: GroupPlan) {
    if (!selectedFormId) return;
    try {
      const res = await applyGroupPlan(selectedFormId, plan);
      await refreshSelectedForm();
      setToast({ type: "success", text: `已应用分组（${res.assigned ?? 0} 人）` });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "应用分组失败") });
    }
  }

  async function handleAssignMemberGroup(memberId: number, groupId: number | null) {
    if (!selectedFormId) return;
    // 乐观更新：拖拽后立即生效，失败再回滚为服务器真值。
    setMembersGroupLocal((m) => (m.id === memberId ? groupId : m.group_id ?? null));
    try {
      await assignMemberGroup(selectedFormId, memberId, groupId);
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "移动成员失败") });
      void openForm(selectedFormId);
    }
  }

  async function handleEditMemberField(member: FormMember, field: string | number, value: unknown) {
    if (!canEditMembers) {
      throw new Error("当前是只读模式，不能修改成员资料");
    }
    if (!selectedFormId) {
      return;
    }
    try {
      await editMemberField({
        form_id: selectedFormId,
        member_id: member.id,
        field,
        value,
      });
      await refreshSelectedForm();
      setToast({ type: "success", text: "成员资料已更新" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "更新成员资料失败") });
      throw err instanceof Error ? err : new Error("更新成员资料失败");
    }
  }

  function handleShowMemberDetail(member: FormRecord["members"][number]) {
    showRegisterDetail({
      member,
      form: selectedForm ?? (selectedFormId ? ({ id: selectedFormId, title: "" } as FormRecord) : undefined),
      formId: selectedFormId ?? undefined,
      extraFields,
      fees,
      onSaveField: canEditMembers ? handleEditMemberField : undefined,
      onPaymentChanged: () => void refreshSelectedForm(),
      canManagePayments,
      canConfirmPayments,
      readOnly: !canEditMembers,
    });
  }

  async function handleOpenParental(member: FormRecord["members"][number]) {
    const formContext = selectedForm ?? (selectedFormId ? ({ id: selectedFormId, title: "" } as FormRecord) : null);
    await open_parental_form(formContext, member, member.parental_data || {}, true, true, {
      onParentDataSync: canEditMembers
        ? (parentData: unknown) => handleEditMemberField(member, "parental_data", parentData)
        : undefined,
    });
  }

  function setRealtime(nextValue: boolean) {
    startTransition(() => {
      setRealtimeEnabled(nextValue);
    });
  }

  return {
    state: {
      forms,
      selectedForm,
      fees,
      extraFields,
      groups,
      loading,
      detailLoading,
      createOpen,
      toast,
      realtimeEnabled,
    },
    actions: {
      loadForms,
      openForm,
      setCreateOpen,
      handleCreateForm,
      handleDeleteForm,
      patchSelectedForm,
      handleAddFee,
      handleEditFee,
      handleDeleteFee,
      handleAddExtraField,
      handleEditExtraField,
      handleDeleteExtraField,
      handlePickEvent,
      handleRemoveEvent,
      handleRemoveMember,
      handleCreateGroup,
      handleRenameGroup,
      handleDeleteGroup,
      handleAssignMemberGroup,
      handleAiChat,
      handleApplyAiPlan,
      handleEditMemberField,
      handleShowMemberDetail,
      handleOpenParental,
      refreshSelectedForm,
      setRealtime,
    },
  };
}
