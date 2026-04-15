import { useMemo, useState } from "react";

import type { DepartmentRecord, PermissionRecord } from "../types";
import { ModalFrame } from "./shared";
import * as styles from "./styles";

export function PermissionModal({
  department,
  permissions,
  onClose,
  onSave,
}: {
  department: DepartmentRecord;
  permissions: PermissionRecord[];
  onClose: () => void;
  onSave: (ids: number[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>(
    (department.permissions || []).map((permission) => permission.id),
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <ModalFrame title={`编辑权限：${department.name}`} onClose={onClose}>
      <div style={styles.permissionGridStyle}>
        {permissions.map((permission) => (
          <label
            key={permission.id}
            style={styles.permissionItemStyle(selectedSet.has(permission.id))}
          >
            <input
              type="checkbox"
              checked={selectedSet.has(permission.id)}
              onChange={(event) =>
                setSelectedIds((prev) =>
                  event.target.checked
                    ? [...prev, permission.id]
                    : prev.filter((id) => id !== permission.id),
                )
              }
            />
            <span>{permission.name}</span>
          </label>
        ))}
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
          onClick={() => onSave(selectedIds)}
        >
          保存权限
        </button>
      </div>
    </ModalFrame>
  );
}
