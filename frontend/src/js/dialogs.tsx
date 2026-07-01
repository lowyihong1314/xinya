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
        background: "linear-gradient(135deg, rgba(194,65,12,0.76), rgba(220,38,38,0.7))",
        soft: "rgba(255,241,242,0.8)",
        border: "rgba(244,63,94,0.24)",
      }
    : {
        background: "linear-gradient(135deg, rgba(14,165,233,0.78), rgba(125,211,252,0.62))",
        soft: "rgba(56,189,248,0.16)",
        border: "rgba(56,189,248,0.24)",
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
  background: "rgba(214,242,255,0.66)",
  backdropFilter: "blur(10px)",
};

const panelStyle: CSSProperties = {
  width: "min(520px, 100%)",
  display: "grid",
  gap: "16px",
  padding: "22px",
  borderRadius: 0,
  background: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(232,247,255,0.62))",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 30px 90px rgba(14,116,144,0.18), inset 0 1px 0 rgba(255,255,255,0.1)",
  color: "rgba(31,78,121,0.92)",
  backdropFilter: "blur(24px) saturate(140%)",
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
  color: "rgba(14,165,233,0.82)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
  lineHeight: 1.1,
  color: "rgba(12,74,110,0.98)",
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.7,
  color: "rgba(57,100,137,0.88)",
  whiteSpace: "pre-wrap",
};

const bodyStyle: CSSProperties = {
  padding: "14px",
  borderRadius: 0,
  border: "1px solid rgba(255,255,255,0.1)",
  backdropFilter: "blur(12px)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  flexWrap: "wrap",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "999px",
  padding: "10px 16px",
  background: "rgba(255,255,255,0.6)",
  color: "rgba(31,78,121,0.9)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 12px 28px rgba(14,116,144,0.12)",
  backdropFilter: "blur(14px)",
};

function primaryButtonStyle(tone: DialogTone): CSSProperties {
  return {
    border: `1px solid ${dialogAccent(tone).border}`,
    borderRadius: "999px",
    padding: "10px 16px",
    background: dialogAccent(tone).background,
    color: "rgba(3,105,161,0.98)",
    fontWeight: 700,
    cursor: "pointer",
  };
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 0,
  border: "1px solid rgba(255,255,255,0.12)",
  padding: "12px 14px",
  boxSizing: "border-box",
  fontSize: "14px",
  background: "rgba(232,247,255,0.44)",
  color: "rgba(12,74,110,0.94)",
  outlineColor: "rgba(56,189,248,0.72)",
  backdropFilter: "blur(12px)",
};

const textAreaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical",
};
