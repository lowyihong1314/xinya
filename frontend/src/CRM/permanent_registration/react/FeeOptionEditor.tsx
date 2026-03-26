import type { CSSProperties } from "react";

export type FeeOptionDraft = {
  id?: number | null;
  age_range_from: string;
  age_range_to: string;
  amount: string;
  description: string;
};

type FeeOptionEditorProps = {
  value: FeeOptionDraft[];
  onChange: (value: FeeOptionDraft[]) => void;
  isMobile: boolean;
  title?: string;
  description?: string;
  amountPlaceholder?: string;
  descriptionPlaceholder?: string;
};

export function createEmptyFeeOptionDraft(): FeeOptionDraft {
  return {
    id: null,
    age_range_from: "",
    age_range_to: "",
    amount: "",
    description: "",
  };
}

export function normalizeFeeOptionDrafts(rawValue: unknown): FeeOptionDraft[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.map((item) => ({
    id: typeof item?.id === "number" ? item.id : null,
    age_range_from: String(item?.age_range_from ?? ""),
    age_range_to: String(item?.age_range_to ?? ""),
    amount: String(item?.amount ?? ""),
    description: String(item?.description ?? ""),
  }));
}

export function summarizeFeeOption(item: {
  age_range_from?: string | number | null;
  age_range_to?: string | number | null;
  amount?: string | number | null;
}) {
  const ageFrom = String(item.age_range_from ?? "").trim();
  const ageTo = String(item.age_range_to ?? "").trim();
  const amount = Number(item.amount || 0);

  let ageLabel = "所有年龄";
  if (ageFrom && ageTo) ageLabel = `${ageFrom}-${ageTo} 岁`;
  else if (ageFrom) ageLabel = `${ageFrom} 岁以上`;
  else if (ageTo) ageLabel = `${ageTo} 岁以下`;

  return `${ageLabel} · RM ${amount.toFixed(2)}`;
}

export function FeeOptionEditor({
  value,
  onChange,
  isMobile,
  title = "年龄报名费选项",
  description = "系统会根据 NRIC 算出的年龄自动挑选适用费率。范围重叠时，会优先选起始年龄更高的那一条。",
  amountPlaceholder = "例如：50.00",
  descriptionPlaceholder = "例如：含教材 / 续费年费",
}: FeeOptionEditorProps) {
  function updateRow(index: number, key: keyof FeeOptionDraft, nextValue: string) {
    onChange(
      value.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: nextValue } : item)),
    );
  }

  function removeRow(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  function addRow() {
    onChange([...value, createEmptyFeeOptionDraft()]);
  }

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={descStyle}>{description}</div>
      </div>

      {value.length ? (
        <div style={listStyle}>
          {value.map((item, index) => (
            <div key={`${item.id ?? "new"}-${index}`} style={cardStyle}>
              <div style={cardHeadStyle(isMobile)}>
                <div style={badgeStyle}>费率 #{index + 1}</div>
                <div style={summaryStyle}>{summarizeFeeOption(item)}</div>
                <button type="button" style={removeButtonStyle} onClick={() => removeRow(index)}>
                  移除
                </button>
              </div>

              <div style={gridStyle(isMobile)}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>起始年龄</span>
                  <input
                    style={inputStyle}
                    value={item.age_range_from}
                    onChange={(event) => updateRow(index, "age_range_from", event.target.value)}
                    placeholder="留空表示不限"
                    inputMode="numeric"
                  />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>结束年龄</span>
                  <input
                    style={inputStyle}
                    value={item.age_range_to}
                    onChange={(event) => updateRow(index, "age_range_to", event.target.value)}
                    placeholder="留空表示不限"
                    inputMode="numeric"
                  />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>金额</span>
                  <input
                    style={inputStyle}
                    value={item.amount}
                    onChange={(event) => updateRow(index, "amount", event.target.value)}
                    placeholder={amountPlaceholder}
                    inputMode="decimal"
                  />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>备注</span>
                  <input
                    style={inputStyle}
                    value={item.description}
                    onChange={(event) => updateRow(index, "description", event.target.value)}
                    placeholder={descriptionPlaceholder}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={emptyStyle}>还没有费率。你可以先加一条“所有年龄”的通用费用，或直接拆成年龄段。</div>
      )}

      <div style={footerStyle}>
        <button type="button" style={addButtonStyle} onClick={addRow}>
          新增费率
        </button>
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = { display: "grid", gap: "14px" };
const headerStyle: CSSProperties = { display: "grid", gap: "6px" };
const titleStyle: CSSProperties = { fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" };
const descStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", lineHeight: 1.6 };
const listStyle: CSSProperties = { display: "grid", gap: "12px" };
const cardStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.82)",
  border: "1px solid var(--x-color-line-soft)",
  display: "grid",
  gap: "12px",
};
const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "rgba(15,118,110,0.12)",
  color: "var(--x-color-accent-strong)",
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
const summaryStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink)" };
const removeButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "999px",
  border: "1px solid rgba(180,35,24,0.18)",
  background: "#fff1f2",
  color: "#b42318",
  fontWeight: 700,
  cursor: "pointer",
};
const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };
const labelStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "44px",
  padding: "11px 13px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-strong)",
  boxSizing: "border-box",
};
const emptyStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "16px",
  border: "1px dashed var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.6,
};
const footerStyle: CSSProperties = { display: "flex", justifyContent: "flex-start" };
const addButtonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-strong)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

function cardHeadStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: isMobile ? "flex-start" : "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
  };
}

function gridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
    gap: "12px",
  };
}
