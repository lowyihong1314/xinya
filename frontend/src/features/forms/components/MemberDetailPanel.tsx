import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { Button, Input, Select, Textarea, useToast } from "@/shared/ui";
import { formKeys, updateMemberField } from "../api";
import type { FormMember, RegisFormDetail } from "../types";
import { PaymentList } from "./PaymentList";
import {
  extraFieldRawText,
  extraFieldText,
  formatDateTime,
  memberFieldsOf,
  normalizeExtraFieldType,
  sortedExtraFields,
} from "./memberFields";

/**
 * 展开的报名记录明细。
 *
 * ★ 显示哪些字段完全由表单配置推导（memberFieldsOf + sortedExtraFields），
 *   这里**没有**任何写死的字段列表。
 * ★ 后端 /form/edit_member 一次只收**一个** field，所以编辑是逐格的：
 *   点铅笔 → 改 → 保存，一格一次请求。做成「整张表单一次提交」反而要发 N 个请求，
 *   而且中途失败会留下改了一半的记录。
 */
export function MemberDetailPanel({
  form,
  member,
  canEdit,
}: {
  form: RegisFormDetail;
  member: FormMember;
  canEdit: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (input: { field: string | number; value: unknown }) =>
      updateMemberField({
        form_id: form.id,
        member_id: member.id,
        field: input.field,
        value: input.value,
      }),
    onSuccess: () => {
      toast.success("已保存");
      void qc.invalidateQueries({ queryKey: formKeys.detail(form.id) });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const commit = async (field: string | number, value: unknown) => {
    await save.mutateAsync({ field, value });
  };

  const fields = memberFieldsOf(form);
  const extras = sortedExtraFields(form);
  const switches = form.field_switches;

  return (
    <div className="space-y-5 py-2">
      <section className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* NRIC 只读：改它会走「合并成员」那条路，要先看影响预览，界面还没做 */}
        <ReadOnlyField label="NRIC" value={member.nric || "—"} mono />
        {fields.map((field) => (
          <EditableField
            key={field.field}
            label={field.label}
            value={stringOf(member[field.field])}
            editable={canEdit}
            multiline={field.multiline}
            onSave={(next) => commit(field.field, next)}
          />
        ))}
      </section>

      {extras.length > 0 ? (
        <section>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">自定义字段</h4>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {extras.map((config) => {
              const type = normalizeExtraFieldType(config.field_type);
              return (
                <EditableField
                  key={config.id}
                  label={config.label}
                  value={extraFieldText(member, config)}
                  draftValue={extraFieldRawText(member, config)}
                  editable={canEdit}
                  multiline={type === "textarea"}
                  inputType={type === "number" ? "number" : type === "date" ? "date" : "text"}
                  // select 用配置里的选项；checkbox 后端存布尔，界面给「是/否」两个值
                  options={
                    type === "select"
                      ? (config.options ?? [])
                      : type === "checkbox"
                        ? [
                            { value: "1", label: "是" },
                            { value: "0", label: "否" },
                          ]
                        : undefined
                  }
                  // ★ field 传配置 id（数字），不是 label —— 后端只认 field_config_id。
                  onSave={(next) => commit(config.id, next)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {switches?.parental_form ? (
        <section>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">家长同意书</h4>
          {member.parental_data ? (
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyField label="家长（中）" value={member.parental_data.parent_cn || "—"} />
              <ReadOnlyField label="家长（英）" value={member.parental_data.parent_en || "—"} />
              <ReadOnlyField label="家长 NRIC" value={member.parental_data.parent_nric || "—"} mono />
              <ReadOnlyField label="家长电话" value={member.parental_data.parent_phone || "—"} />
              <ReadOnlyField label="签名" value={member.parental_data.sign || "未签"} />
              <ReadOnlyField label="签署日期" value={member.parental_data.sign_date || "—"} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">尚未签署。</p>
          )}
        </section>
      ) : null}

      {switches?.flexible_time_slot ? (
        <section>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">可参加时段</h4>
          <p className="text-sm">{timeSlotText(member.available_time_slot_json)}</p>
        </section>
      ) : null}

      <section>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">缴费记录</h4>
        <PaymentList formId={form.id} payments={member.payments ?? []} />
      </section>

      <p className="text-xs text-muted-foreground">
        资料最后修改：{formatDateTime(member.edit_at)}
      </p>
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

/**
 * 一格「点铅笔才能改」的字段。
 * ★ 保存失败时**保持编辑态**（mutateAsync 抛出来，这里吃掉）——
 *   关掉的话用户看到的是旧值，会以为改成功了。
 */
function EditableField({
  label,
  value,
  draftValue,
  editable,
  multiline,
  inputType = "text",
  options,
  onSave,
}: {
  label: string;
  /** 给人看的文本（勾选框是「是/否」这种）。 */
  value: string;
  /** 放进输入框的原始值，不传就用 value。 */
  draftValue?: string;
  editable: boolean;
  multiline?: boolean;
  inputType?: "text" | "number" | "date";
  options?: readonly string[] | readonly SelectOption[];
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // 错误提示由 mutation 的 onError 统一发，这里只负责不关编辑框
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="flex items-start gap-1">
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">
            {value || "—"}
          </span>
          {editable ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={`编辑${label}`}
              onClick={() => {
                setDraft(draftValue ?? value);
                setEditing(true);
              }}
            >
              <Pencil className="size-3" />
            </Button>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {options ? (
        <Select
          className="h-9"
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        >
          <option value="">（留空）</option>
          {normalizeOptions(options).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : multiline ? (
        <Textarea
          className="min-h-20"
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <Input
          className="h-9"
          type={inputType}
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      <div className="flex gap-1.5">
        <Button size="sm" loading={busy} onClick={() => void submit()}>
          保存
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "break-all font-mono text-sm" : "break-words text-sm"}>{value}</p>
    </div>
  );
}

function normalizeOptions(
  options: readonly string[] | readonly SelectOption[],
): SelectOption[] {
  return options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
}

/** 成员身上的字段值可能是 null / 数字 / 对象，统一成给输入框用的字符串。 */
function stringOf(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

/** 弹性时段的形状随报名页而定（后端原样存 JSON），只做最低限度的可读化。 */
function timeSlotText(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (Array.isArray(raw)) return raw.length ? raw.map((v) => String(v)).join("、") : "—";
  if (typeof raw === "object") {
    const picked = Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
    return picked.length ? picked.join("、") : "—";
  }
  return String(raw);
}
