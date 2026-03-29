import { useEffect, useMemo, useState } from "react";
import { startTransition } from "react";

import { open_parental_form } from "../../../../../static/js/form/parental/modal.js";
import { showEventPicker } from "../../shared/showEventPicker";
import { showRegisterDetail } from "./showRegisterDetail";
import {
  addEventToForm,
  addExtraField,
  addFee,
  createForm,
  deleteExtraField,
  deleteFee,
  editMemberField,
  editExtraField,
  editFee,
  editForm,
  fetchFormDetail,
  fetchForms,
  listExtraFields,
  listFees,
  removeEventFromForm,
  removeForm,
  removeMemberFromForm,
} from "./api";
import type { ExtraFieldConfig, FormCreatePayload, FormFee, FormFieldSwitches, FormMember, FormRecord } from "./types";
import { useFormRealtime } from "./useFormRealtime";

type Toast = { type: "success" | "error"; text: string } | null;

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
    medical: form.field_switches?.medical ?? Boolean(form.medical),
    allergy: form.field_switches?.allergy ?? Boolean(form.allergy),
    address: form.field_switches?.address ?? Boolean(form.address),
  };

  return {
    ...form,
    field_switches: fieldSwitches,
    ...fieldSwitches,
  };
}

export function useFormWorkspace(options?: { enabled?: boolean; canEditMembers?: boolean }) {
  const enabled = options?.enabled ?? true;
  const canEditMembers = options?.canEditMembers ?? true;
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [selectedForm, setSelectedForm] = useState<FormRecord | null>(null);
  const [fees, setFees] = useState<FormFee[]>([]);
  const [extraFields, setExtraFields] = useState<ExtraFieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setForms([]);
      setSelectedFormId(null);
      setSelectedForm(null);
      setFees([]);
      setExtraFields([]);
      setLoading(false);
      setDetailLoading(false);
      return;
    }

    void loadForms();
  }, [enabled]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useFormRealtime({
    enabled: enabled && realtimeEnabled,
    formId: selectedFormId,
    onRefresh: () => {
      void refreshSelectedForm();
    },
  });

  function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }

  async function loadForms(preferredFormId?: number | null) {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const payload = await fetchForms();
      const nextForms = Array.isArray(payload.forms) ? payload.forms : [];
      setForms(nextForms.map((form) => normalizeFieldSwitches(form) as FormRecord));

      const nextSelectedId =
        preferredFormId ?? selectedFormId ?? nextForms[0]?.id ?? null;

      if (nextSelectedId) {
        await openForm(nextSelectedId, nextForms);
      } else {
        setSelectedFormId(null);
        setSelectedForm(null);
        setFees([]);
        setExtraFields([]);
      }
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

    setSelectedFormId(formId);
    setDetailLoading(true);
    try {
      const [detailPayload, feesPayload, extraPayload] = await Promise.all([
        fetchFormDetail(formId),
        listFees(formId),
        listExtraFields(formId),
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
    await openForm(selectedFormId);
    await loadForms(selectedFormId);
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

  async function handleDeleteForm(formId: number) {
    if (!window.confirm("确认删除这个报名表？")) {
      return;
    }
    try {
      await removeForm(formId);
      const nextForms = forms.filter((item) => item.id !== formId);
      setForms(nextForms);
      const nextSelected = nextForms[0]?.id ?? null;
      if (nextSelected) {
        await openForm(nextSelected, nextForms);
      } else {
        setSelectedFormId(null);
        setSelectedForm(null);
        setFees([]);
        setExtraFields([]);
      }
      setToast({ type: "success", text: "报名表已删除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "删除报名表失败") });
    }
  }

  async function patchSelectedForm(patch: Partial<FormRecord>) {
    if (!selectedFormId || !selectedForm) {
      return;
    }
    try {
      await editForm(selectedFormId, patch);
      const nextForm = normalizeFieldSwitches({
        ...selectedForm,
        ...patch,
        field_switches: {
          ...(selectedForm.field_switches || {}),
          ...patch.field_switches,
        },
      });
      setSelectedForm(nextForm);
      setForms((prev) =>
        prev.map((item) =>
          item.id === selectedFormId
            ? (normalizeFieldSwitches({
                ...item,
                ...patch,
                field_switches: {
                  ...(item.field_switches || {}),
                  ...patch.field_switches,
                },
              }) as FormRecord)
            : item,
        ),
      );
      setToast({ type: "success", text: "表单信息已更新" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "更新表单信息失败") });
    }
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
      setToast({ type: "success", text: "扩展字段已添加" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "添加扩展字段失败") });
    }
  }

  async function handleEditExtraField(
    fieldId: number,
    payload: { label: string; field_type: string; options?: string[] | null; order?: number | null },
  ) {
    try {
      await editExtraField(fieldId, payload);
      await refreshSelectedForm();
      setToast({ type: "success", text: "扩展字段已更新" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "更新扩展字段失败") });
    }
  }

  async function handleDeleteExtraField(fieldId: number) {
    try {
      await deleteExtraField(fieldId);
      await refreshSelectedForm();
      setToast({ type: "success", text: "扩展字段已删除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "删除扩展字段失败") });
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
    if (!window.confirm("确认移出这个成员？")) return;
    try {
      await removeMemberFromForm(selectedFormId, memberId);
      await refreshSelectedForm();
      setToast({ type: "success", text: "成员已移除" });
    } catch (err) {
      setToast({ type: "error", text: getErrorMessage(err, "移除成员失败") });
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
      formId: selectedFormId ?? undefined,
      extraFields,
      onSaveField: canEditMembers ? handleEditMemberField : undefined,
      readOnly: !canEditMembers,
    });
  }

  async function handleOpenParental(member: FormRecord["members"][number]) {
    await open_parental_form(null, member, member.parental_data, true, true);
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
      handleEditMemberField,
      handleShowMemberDetail,
      handleOpenParental,
      refreshSelectedForm,
      setRealtime,
    },
  };
}
