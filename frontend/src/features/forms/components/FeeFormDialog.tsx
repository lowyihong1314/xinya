import { useState, type FormEvent } from "react";

import {
  Button,
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

import type { FeeInput } from "../api";
import type { FormFee } from "../types";

/**
 * 新增 / 修改收费项。
 *
 * ★ 同一张表可以有多条收费项，公开付款页按**报名者年龄**从里面挑一条
 *   （/form/payment_quote 用 NRIC 算年龄）。所以年龄区间不是装饰，留空才是「不限」。
 * 校验交给后端：「类别和金额不能为空」「起始年龄…」都有现成文案。
 */
export function FeeFormDialog({
  fee,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 新增。 */
  fee: FormFee | null;
  onSubmit: (input: FeeInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [category, setCategory] = useState(fee?.category ?? "");
  // 金额与年龄都用字符串存：数字 state 会把「清空」变成 0，而 0 岁是有意义的值。
  const [amount, setAmount] = useState(fee?.amount != null ? String(fee.amount) : "");
  const [ageFrom, setAgeFrom] = useState(fee?.age_range_from != null ? String(fee.age_range_from) : "");
  const [ageTo, setAgeTo] = useState(fee?.age_range_to != null ? String(fee.age_range_to) : "");
  const [description, setDescription] = useState(fee?.description ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      category,
      amount,
      // 空串 → 后端 _normalize_optional_age_bound 当成「不限」写 null
      age_range_from: ageFrom.trim(),
      age_range_to: ageTo.trim(),
      description: description.trim() || null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fee ? "修改收费项" : "新增收费项"}</DialogTitle>
          <DialogDescription>
            付款页按报名者年龄挑收费项。年龄两端留空表示不限。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fee-category">类别</Label>
              <Input
                id="fee-category"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="成人 / 儿童 / 学生"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fee-amount">金额</Label>
              <Input
                id="fee-amount"
                type="number"
                step="0.01"
                min={0}
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fee-age-from">起始年龄</Label>
              <Input
                id="fee-age-from"
                type="number"
                min={0}
                inputMode="numeric"
                value={ageFrom}
                onChange={(e) => setAgeFrom(e.target.value)}
                placeholder="留空 = 不限"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fee-age-to">结束年龄</Label>
              <Input
                id="fee-age-to"
                type="number"
                min={0}
                inputMode="numeric"
                value={ageTo}
                onChange={(e) => setAgeTo(e.target.value)}
                placeholder="留空 = 不限"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fee-description">说明</Label>
            <Textarea
              id="fee-description"
              className="min-h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="含住宿、含餐…（可留空）"
            />
          </div>

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
