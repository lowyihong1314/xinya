import { useState } from "react";

import { Field, ModalFrame } from "./shared";
import * as styles from "./styles";
import type { CreateUserPayload } from "./types";

export function NewUserModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: CreateUserPayload) => void;
}) {
  const [form, setForm] = useState<CreateUserPayload>({
    username: "",
    email: "",
    phone: "",
    password: "",
  });

  return (
    <ModalFrame title="新增用户" onClose={onClose}>
      <div style={styles.formGridStyle}>
        <Field
          label="用户名"
          value={form.username}
          onChange={(value) => setForm((prev) => ({ ...prev, username: value }))}
        />
        <Field
          label="邮箱"
          value={form.email}
          onChange={(value) => setForm((prev) => ({ ...prev, email: value }))}
        />
        <Field
          label="电话"
          value={form.phone || ""}
          onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))}
        />
        <Field
          label="密码"
          type="password"
          value={form.password}
          onChange={(value) => setForm((prev) => ({ ...prev, password: value }))}
        />
      </div>
      <div style={styles.modalFooterStyle}>
        <button
          type="button"
          style={styles.secondaryButtonStyle}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          style={styles.primaryButtonStyle}
          onClick={() => onSubmit(form)}
        >
          保存
        </button>
      </div>
    </ModalFrame>
  );
}
