import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/shared/api/errors";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
  useToast,
} from "@/shared/ui";
import { changePassword, saveProfile } from "../api";

/**
 * 可自助编辑的字段。**与后端 SELF_EDITABLE_USER_FIELDS 对齐**
 * （backend/api/user_control/service.py:82）—— 多写一个后端会忽略，
 * 少写一个用户就改不了。
 *
 * ★ is_member **不在这里**：自助改资料改不动会员身份，那要走会员审核流程。
 */
const PERSONAL_FIELDS = [
  { key: "display_name", label: "显示名称", type: "text" },
  { key: "username", label: "用户名", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "电话", type: "tel" },
  { key: "NRIC", label: "身份证号", type: "text" },
] as const;

/** 转账资料。描述文案沿用旧版 BANK_NOTE_FIELDS。 */
const BANK_FIELDS = [
  { key: "bank_name", label: "银行名称", description: "填写你常用收款银行的名称，方便后续核对与转账。" },
  { key: "account_name", label: "账户名称", description: "填写银行账户持有人姓名，建议与银行资料一致。" },
  { key: "bank_account", label: "银行账号", description: "填写你个人收款银行账号，可用于后续转账或人工核对。" },
  { key: "tng_number", label: "TNG 号码", description: "填写你的 Touch 'n Go 绑定号码，方便个人电子钱包转账。" },
] as const;

export function ProfileForm() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  // 用当前用户的值做初值。后端 edit_user_data 收的是**整份字段**，
  // 所以提交时要把没改的也带上 —— 只发改动的那几个会把其余清空。
  const [form, setForm] = useState<Record<string, string>>(() => pickFields(user));

  const save = useMutation({
    mutationFn: () => saveProfile(form),
    onSuccess: async () => {
      toast.success("资料已更新");
      await refresh(); // 顶栏显示的名字要跟着变
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "更新失败"),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>个人资料</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {PERSONAL_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type={f.type}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  autoCapitalize={f.key === "username" ? "none" : undefined}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="gender">性别</Label>
              <Select
                id="gender"
                value={form.gender ?? ""}
                onChange={(e) => setForm({ ...form, gender: e.target.value })}
              >
                <option value="">未填写</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="medical">医疗状况</Label>
              <Textarea
                id="medical"
                value={form.medical ?? ""}
                onChange={(e) => setForm({ ...form, medical: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="allergy">过敏</Label>
              <Textarea
                id="allergy"
                value={form.allergy ?? ""}
                onChange={(e) => setForm({ ...form, allergy: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>转账资料</CardTitle>
            <CardDescription>报销打款时会用到这几项。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {BANK_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="mt-4 flex justify-end">
          <Button type="submit" loading={save.isPending}>
            保存
          </Button>
        </div>
      </form>

      <PasswordCard />
    </div>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: () => changePassword({ old_password: oldPassword, new_password: newPassword }),
    onSuccess: () => {
      toast.success("密码已修改");
      setOld("");
      setNew("");
      setConfirm("");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "修改失败"),
  });

  // 两次输入不一致是**纯前端**的校验（后端只收一个 new_password，
  // 它没法知道用户打错了）。其余校验（长度、旧密码对不对）交给后端。
  const mismatch = confirm.length > 0 && newPassword !== confirm;

  return (
    <Card>
      <CardHeader>
        <CardTitle>修改密码</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) change.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="old-pw">当前密码</Label>
            <Input
              id="old-pw"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOld(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">新密码</Label>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">确认新密码</Label>
            <Input
              id="confirm-pw"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              aria-invalid={mismatch || undefined}
            />
            {mismatch ? (
              <p role="alert" className="text-sm text-destructive">
                两次输入的新密码不一致
              </p>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={change.isPending} disabled={mismatch}>
              修改密码
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** 从当前用户对象里挑出可编辑的字段，缺的补空串（受控输入不能给 undefined）。 */
function pickFields(user: Record<string, unknown> | null): Record<string, string> {
  const keys = [
    ...PERSONAL_FIELDS.map((f) => f.key as string),
    ...BANK_FIELDS.map((f) => f.key as string),
    "gender",
    "medical",
    "allergy",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = user?.[k];
    out[k] = v == null ? "" : String(v);
  }
  return out;
}
