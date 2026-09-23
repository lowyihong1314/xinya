import { useState, type FormEvent } from "react";

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@/shared/ui";

import type { FormInput } from "../api";
import type { FieldSwitchKey, RegisFormSummary } from "../types";
import { SWITCH_OPTIONS } from "./memberFields";

/**
 * 建表 / 改表设置。
 *
 * ★ 调用方**只在要用的时候才挂载它**（`{editing !== undefined && <FormSettingsDialog …/>}`），
 *   这样每次打开都是全新的 useState。常驻挂载 + open 开关会把上次没提交的输入
 *   留到下一次打开。
 *
 * 校验全部交给后端：缺字段、日期格式、人数不是整数都有现成的中文文案
 * （「缺少字段: title」「expired 格式需为 YYYY-MM-DD」「最大报名人数需为整数」）。
 * 前端只做 required，不再写一套。
 */
export function FormSettingsDialog({
  form,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 新建。 */
  form: RegisFormSummary | null;
  onSubmit: (input: FormInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState(form?.title ?? "");
  const [detail, setDetail] = useState(form?.detail ?? "");
  const [notes, setNotes] = useState(form?.notes ?? "");
  // 后端 expired 是 "YYYY-MM-DD"，<input type="date"> 认的也是这个，不用转换。
  const [expired, setExpired] = useState(form?.expired?.slice(0, 10) ?? "");
  // 人数用字符串存：数字 state 会把「清空输入框」变成 0，而 0 和「不限」看起来一样。
  const [maxMembers, setMaxMembers] = useState(
    form?.max_members != null ? String(form.max_members) : "",
  );
  const [closed, setClosed] = useState(Boolean(form?.closed_manually));
  const [switches, setSwitches] = useState<Partial<Record<FieldSwitchKey, boolean>>>(() =>
    Object.fromEntries(SWITCH_OPTIONS.map(({ key }) => [key, Boolean(form?.field_switches?.[key])])),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      title,
      detail,
      notes,
      expired,
      // 空串 = 不限人数，后端 _normalize_max_members 认这个。
      max_members: maxMembers.trim(),
      closed_manually: closed,
      // 嵌套着传：后端优先读 field_switches，读不到才退回顶层同名键。
      // parent_1_phone / parent_2_phone 不传 —— 后端会照 parent_1 / parent_2 补齐。
      field_switches: switches,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form ? "表单设置" : "新建报名表"}</DialogTitle>
          <DialogDescription>
            勾上的字段才会出现在报名页和报名记录里。建表后还能再改。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="form-title">表单名称</Label>
            <Input
              id="form-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="2026 年浴佛节报名"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-detail">活动说明</Label>
            <Textarea
              id="form-detail"
              required
              className="min-h-24"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="显示在公开报名页顶部"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="form-notes">注意事项</Label>
            <Textarea
              id="form-notes"
              className="min-h-20"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="显示在成员终端的信息页（可留空）"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="form-expired">报名截止日</Label>
              <Input
                id="form-expired"
                type="date"
                required
                value={expired}
                onChange={(e) => setExpired(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="form-max">名额上限</Label>
              <Input
                id="form-max"
                type="number"
                min={1}
                inputMode="numeric"
                value={maxMembers}
                onChange={(e) => setMaxMembers(e.target.value)}
                placeholder="留空 = 不限"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">报名要收的字段</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SWITCH_OPTIONS.map(({ key, label, hint }) => (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5">
                    <Checkbox
                      checked={Boolean(switches[key])}
                      onChange={(e) => setSwitches((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                  </span>
                  <span className="min-w-0">
                    {label}
                    {hint ? (
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 手动终止和截止日是两件事：日子没到也能先关掉 */}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            手动终止报名（勾上后即使没到截止日也不再接受报名）
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
