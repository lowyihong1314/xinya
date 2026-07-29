import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { openOverlay } from "../app/OverlayProvider";
import { ensureDesignTokens } from "../theme/designTokens";

type DialogTone = "default" | "danger";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
};

type PromptOptions = {
  title?: string;
  message: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
  multiline?: boolean;
  readOnly?: boolean;
};

function DialogFrame({
  title,
  message,
  children,
  actions,
  tone = "default",
  onClose,
}: {
  title: string;
  message: string;
  children?: ReactNode;
  actions: ReactNode;
  tone?: DialogTone;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <span style={iconBadgeStyle(tone)}>
            <i className={tone === "danger" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-circle-info"} />
          </span>
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <h3 style={titleStyle}>{title}</h3>
            <p style={messageStyle}>{message}</p>
          </div>
        </div>
        {children ? <div>{children}</div> : null}
        <div style={actionsStyle}>{actions}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <DialogFrame
      title={options.title || "请确认"}
      message={options.message}
      tone={options.tone}
      onClose={() => onResolve(false)}
      actions={
        <>
          <button type="button" style={secondaryButtonStyle} onClick={() => onResolve(false)}>
            {options.cancelText || "取消"}
          </button>
          <button type="button" style={primaryButtonStyle(options.tone || "default")} onClick={() => onResolve(true)}>
            {options.confirmText || "确认"}
          </button>
        </>
      }
    />
  );
}

function PromptDialog({
  options,
  onResolve,
}: {
  options: PromptOptions;
  onResolve: (value: string | null) => void;
}) {
  const [value, setValue] = useState(options.initialValue || "");

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !options.multiline && !options.readOnly) {
      onResolve(value);
    }
  };

  const inputNode = options.multiline ? (
    <textarea
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={options.placeholder}
      readOnly={options.readOnly}
      style={textAreaStyle}
      autoFocus={!options.readOnly}
    />
  ) : (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={submitOnEnter}
      placeholder={options.placeholder}
      readOnly={options.readOnly}
      style={inputStyle}
      autoFocus={!options.readOnly}
      onFocus={options.readOnly ? (event) => event.target.select() : undefined}
    />
  );

  return (
    <DialogFrame
      title={options.title || "请输入"}
      message={options.message}
      tone={options.tone}
      onClose={() => onResolve(null)}
      actions={
        <>
          {!options.readOnly ? (
            <button type="button" style={secondaryButtonStyle} onClick={() => onResolve(null)}>
              {options.cancelText || "取消"}
            </button>
          ) : null}
          <button
            type="button"
            style={primaryButtonStyle(options.tone || "default")}
            onClick={() => onResolve(options.readOnly ? null : value)}
          >
            {options.confirmText || (options.readOnly ? "关闭" : "确认")}
          </button>
        </>
      }
    >
      {inputNode}
    </DialogFrame>
  );
}

export function showConfirmDialog(options: ConfirmOptions) {
  ensureDesignTokens();
  return new Promise<boolean>((resolve) => {
    openOverlay((close) => (
      <ConfirmDialog
        options={options}
        onResolve={(confirmed) => {
          close();
          resolve(confirmed);
        }}
      />
    ));
  });
}

export function showPromptDialog(options: PromptOptions) {
  ensureDesignTokens();
  return new Promise<string | null>((resolve) => {
    openOverlay((close) => (
      <PromptDialog
        options={options}
        onResolve={(value) => {
          close();
          resolve(value);
        }}
      />
    ));
  });
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "grid",
  placeItems: "center",
  padding: "20px",
  background: "rgba(15, 23, 42, 0.45)",
};

const panelStyle: CSSProperties = {
  width: "min(420px, 100%)",
  display: "grid",
  gap: "18px",
  padding: "20px",
  borderRadius: "var(--x-radius-md, 16px)",
  background: "var(--x-color-panel, #ffffff)",
  boxShadow: "0 24px 64px rgba(15, 23, 42, 0.24)",
  color: "var(--x-color-ink, #1d2433)",
  fontFamily: "var(--x-font-sans, sans-serif)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "12px",
};

function iconBadgeStyle(tone: DialogTone): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 12,
    flexShrink: 0,
    fontSize: 16,
    background: tone === "danger" ? "var(--x-color-danger-soft, #ffedd5)" : "var(--x-color-accent-soft, #d9f3ef)",
    color: tone === "danger" ? "var(--x-color-danger, #c2410c)" : "var(--x-color-accent-strong, #115e59)",
  };
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "16px",
  fontWeight: 700,
  lineHeight: 1.3,
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "13.5px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted, #5d6678)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "8px",
  flexWrap: "wrap",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line, #d8dfeb)",
  borderRadius: 8,
  padding: "8px 16px",
  background: "var(--x-color-panel, #ffffff)",
  color: "var(--x-color-ink, #1d2433)",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};

function primaryButtonStyle(tone: DialogTone): CSSProperties {
  return {
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    background: tone === "danger" ? "var(--x-color-danger, #c2410c)" : "var(--x-color-accent, #0f766e)",
    color: "#ffffff",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid var(--x-color-line, #d8dfeb)",
  padding: "10px 12px",
  boxSizing: "border-box",
  fontSize: "13.5px",
  background: "var(--x-color-panel, #ffffff)",
  color: "var(--x-color-ink, #1d2433)",
  outlineColor: "var(--x-color-accent, #0f766e)",
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical",
  fontFamily: "var(--x-font-sans, sans-serif)",
};
