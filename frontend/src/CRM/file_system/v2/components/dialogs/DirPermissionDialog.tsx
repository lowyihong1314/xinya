import { useState } from "react";

import { useFsActions, useFsState } from "../../context";
import { dialogInputStyle, dialogLabelStyle } from "../../styles";
import type { SelectableItem } from "../../types";
import { DialogShell } from "./DialogShell";

const PERMISSION_OPTIONS = [
  { value: "read", label: "只读" },
  { value: "read_write", label: "读写" },
  { value: "read_public", label: "公开可读" },
];

export function DirPermissionDialog({ dir }: { dir: SelectableItem }) {
  const { users, departments } = useFsState();
  const actions = useFsActions();
  const [targetType, setTargetType] = useState<"user" | "department">("user");
  const [targetId, setTargetId] = useState("");
  const [permission, setPermission] = useState("read");

  const targets =
    targetType === "user"
      ? users.map((user) => ({ id: user.id, label: user.display_name || user.username || `#${user.id}` }))
      : departments.map((department) => ({ id: department.id, label: department.name }));

  return (
    <DialogShell
      title={`设置「${dir.name}」目录权限`}
      onClose={actions.closeDialog}
      onConfirm={() => {
        const id = Number(targetId);
        if (id) void actions.submitDirPermission(dir.path, targetType, id, permission);
      }}
      confirmText="应用到整个目录"
      confirmDisabled={!targetId}
    >
      <span style={{ fontSize: 12.5, color: "var(--x-color-ink-muted)" }}>
        权限会应用到该目录下的所有文件与子目录。
      </span>
      <label style={dialogLabelStyle}>
        授权对象类型
        <select
          style={dialogInputStyle}
          value={targetType}
          onChange={(event) => {
            setTargetType(event.target.value as "user" | "department");
            setTargetId("");
          }}
        >
          <option value="user">用户</option>
          <option value="department">部门</option>
        </select>
      </label>
      <label style={dialogLabelStyle}>
        {targetType === "user" ? "用户" : "部门"}
        <select style={dialogInputStyle} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">请选择…</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </label>
      <label style={dialogLabelStyle}>
        权限
        <select style={dialogInputStyle} value={permission} onChange={(event) => setPermission(event.target.value)}>
          {PERMISSION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </DialogShell>
  );
}
