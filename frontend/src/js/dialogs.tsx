import { useState, type CSSProperties, type ReactNode } from "react";

import { openOverlay } from "../app/OverlayProvider";

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

function dialogAccent(tone: DialogTone) {
  return tone === "danger"
    ? {
        background: "linear-gradient(135deg, #c2410c, #dc2626)",
        soft: "rgba(194,65,12,0.08)",
        border: "rgba(194,65,12,0.18)",
      }
    : {
        background: "linear-gradient(135deg, #0f766e, #1d4ed8)",
        soft: "rgba(15,118,110,0.08)",
        border: "rgba(15,118,110,0.18)",
      };
}

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
  const accent = dialogAccent(tone);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...panelStyle, borderColor: accent.border }} onClick={(event) => event.stopPropagation()}>
        <div style={{ ...accentBarStyle, background: accent.background }} />
        <div style={headerStyle}>
          <div style={eyebrowStyle}>Dialog</div>
          <h3 style={titleStyle}>{title}</h3>
          <p style={messageStyle}>{message}</p>
        </div>
        {children ? <div style={{ ...bodyStyle, background: accent.soft }}>{children}</div> : null}
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
      placeholder={options.placeholder}
      readOnly={options.readOnly}
      style={inputStyle}
      autoFocus={!options.readOnly}
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
  background: "rgba(15, 23, 42, 0.52)",
  backdropFilter: "blur(8px)",
};

const panelStyle: CSSProperties = {
  width: "min(520px, 100%)",
  display: "grid",
  gap: "16px",
  padding: "22px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
  border: "1px solid rgba(148,163,184,0.2)",
  boxShadow: "0 28px 64px rgba(15,23,42,0.2)",
};

const accentBarStyle: CSSProperties = {
  width: "72px",
  height: "6px",
  borderRadius: "999px",
};

const headerStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "rgba(71,85,105,0.84)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
  lineHeight: 1.1,
  color: "var(--x-color-ink, #0f172a)",
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted, #475569)",
  whiteSpace: "pre-wrap",
};

const bodyStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "18px",
  border: "1px solid rgba(148,163,184,0.12)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  flexWrap: "wrap",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(148,163,184,0.26)",
  borderRadius: "999px",
  padding: "10px 16px",
  background: "rgba(255,255,255,0.9)",
  color: "var(--x-color-ink, #0f172a)",
  fontWeight: 700,
  cursor: "pointer",
};

function primaryButtonStyle(tone: DialogTone): CSSProperties {
  return {
    border: "none",
    borderRadius: "999px",
    padding: "10px 16px",
    background: dialogAccent(tone).background,
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: "14px",
  border: "1px solid rgba(148,163,184,0.26)",
  padding: "12px 14px",
  boxSizing: "border-box",
  fontSize: "14px",
  background: "rgba(255,255,255,0.96)",
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical",
};
