import type { ReactNode } from "react";

import * as styles from "./styles";

export function ModalFrame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={styles.overlayStyle} onClick={onClose}>
      <div style={styles.modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={styles.modalHeaderStyle}>
          <h4 style={styles.modalTitleStyle}>{title}</h4>
          <button
            type="button"
            style={styles.secondaryButtonStyle}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  textarea,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  type?: string;
}) {
  return (
    <label style={styles.fieldStyle}>
      <span style={styles.fieldLabelStyle}>{label}</span>
      {textarea ? (
        <textarea
          rows={4}
          style={styles.textareaStyle}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type={type}
          style={styles.inputStyle}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
