import { useState, type CSSProperties } from "react";

import {
  PAIWEI_TEMPLATES,
  arrayToLines,
  getDraftQuantity,
  getDraftTotalPrice,
  getDraftUnitPrice,
  getTemplate,
  linesToArray,
  validateDraft,
  type PaiweiCode,
  type PaiweiDraft,
} from "./paiwei";

// 多人字段在编辑器里必须用「数组」维护（允许空行），保存时才拼回 draft 的换行字符串。
// 否则空行会被 arrayToLines 过滤掉，导致「添加」按钮看起来点了没反应。
function initRows(value: string): string[] {
  const arr = linesToArray(value);
  return arr.length ? arr : [""];
}

const MAX_OWNERS = 8;
const MAX_DECEASED = 6;

function deceasedLabel(code: PaiweiCode): string {
  return code === "A3" || code === "B3" ? "子女" : "对象";
}

type PaiweiEditorModalProps = {
  initialDraft: PaiweiDraft;
  isEdit: boolean;
  relationOptions?: string[];
  onCancel: () => void;
  onSave: (draft: PaiweiDraft) => void;
};

export function PaiweiEditorModal({
  initialDraft,
  isEdit,
  relationOptions = [],
  onCancel,
  onSave,
}: PaiweiEditorModalProps) {
  const [draft, setDraft] = useState<PaiweiDraft>(initialDraft);
  const [owners, setOwners] = useState<string[]>(() => initRows(initialDraft.owner));
  const [deceaseds, setDeceaseds] = useState<string[]>(() => initRows(initialDraft.deceased));
  const [relations, setRelations] = useState<string[]>(() => initRows(initialDraft.relation));
  const [error, setError] = useState("");

  const template = getTemplate(draft.code);

  function patch(next: Partial<PaiweiDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setError("");
  }

  function changeCode(code: PaiweiCode) {
    const nextTemplate = getTemplate(code);
    // 冤亲债主只允许一位阳上：切换过来时把多余的行裁掉。
    if (code === "C") {
      setOwners((current) => current.slice(0, 1));
    }
    setDraft((current) => ({
      ...current,
      code,
      surname: nextTemplate.fields.surname ? current.surname : "",
      suffix: nextTemplate.fields.suffix ? current.suffix || nextTemplate.defaultSuffix || "" : "",
      father: nextTemplate.fields.father ? current.father : "",
      mother: nextTemplate.fields.mother ? current.mother : "",
      quantity: nextTemplate.fields.quantity ? current.quantity || "1" : "",
    }));
    setError("");
  }

  function updatePairs(nextDeceaseds: string[], nextRelations: string[]) {
    setDeceaseds(nextDeceaseds);
    setRelations(nextRelations);
    setError("");
  }

  function buildFinalDraft(): PaiweiDraft {
    return {
      ...draft,
      owner: template.fields.owner ? arrayToLines(owners) : "",
      deceased: template.fields.deceased ? arrayToLines(deceaseds) : "",
      relation: template.fields.relation ? arrayToLines(relations) : "",
    };
  }

  function handleSave() {
    const finalDraft = buildFinalDraft();
    const validationError = validateDraft(finalDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSave(finalDraft);
  }

  const unitPrice = getDraftUnitPrice(draft);
  const quantity = getDraftQuantity(draft);
  const total = getDraftTotalPrice(draft);

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <h3 style={styles.title}>{isEdit ? "编辑牌位" : "添加牌位"}</h3>
          <button type="button" style={styles.closeButton} onClick={onCancel} aria-label="关闭">
            ✕
          </button>
        </header>

        <div style={styles.body}>
          <div style={styles.field}>
            <label style={styles.label}>牌位类型</label>
            <select
              style={styles.select}
              value={draft.code}
              onChange={(event) => changeCode(event.target.value as PaiweiCode)}
            >
              {PAIWEI_TEMPLATES.map((tpl) => (
                <option key={tpl.code} value={tpl.code}>
                  {`${tpl.title} · RM ${tpl.price}`}
                </option>
              ))}
            </select>
            <p style={styles.hint}>{template.hint}</p>
          </div>

          {template.fields.owner ? (
            <RowList
              label="阳上姓名"
              addLabel="添加阳上姓名"
              placeholder="阳上"
              values={owners}
              max={draft.code === "C" ? 1 : MAX_OWNERS}
              onChange={setOwners}
            />
          ) : null}

          {template.fields.deceased && template.fields.relation ? (
            <PairRowList
              nameLabel={deceasedLabel(draft.code)}
              deceaseds={deceaseds}
              relations={relations}
              relationOptions={relationOptions}
              max={MAX_DECEASED}
              onChange={updatePairs}
            />
          ) : template.fields.deceased ? (
            <RowList
              label={`${deceasedLabel(draft.code)}姓名`}
              addLabel={`添加${deceasedLabel(draft.code)}`}
              placeholder={deceasedLabel(draft.code)}
              values={deceaseds}
              max={MAX_DECEASED}
              onChange={setDeceaseds}
            />
          ) : null}

          {template.fields.surname ? (
            <TextField label="姓氏" value={draft.surname} placeholder="例如：陈" onChange={(v) => patch({ surname: v })} />
          ) : null}
          {template.fields.suffix ? (
            <TextField label="堂号 / 内容" value={draft.suffix} placeholder="门堂上历代祖先" onChange={(v) => patch({ suffix: v })} />
          ) : null}
          {template.fields.father ? (
            <TextField label="显考" value={draft.father} placeholder="先父名讳" onChange={(v) => patch({ father: v })} />
          ) : null}
          {template.fields.mother ? (
            <TextField label="显妣" value={draft.mother} placeholder="先母名讳" onChange={(v) => patch({ mother: v })} />
          ) : null}
          {template.fields.quantity ? (
            <TextField
              label="数量"
              value={draft.quantity}
              type="number"
              placeholder="1"
              onChange={(v) => patch({ quantity: v.replace(/[^\d]/g, "") })}
            />
          ) : null}

          <div style={styles.field}>
            <label style={styles.label}>附注（选填）</label>
            <textarea
              style={styles.textarea}
              value={draft.note}
              placeholder="其他需要说明的内容"
              onChange={(event) => patch({ note: event.target.value })}
            />
          </div>
        </div>

        {error ? <div style={styles.error}>{error}</div> : null}

        <footer style={styles.footer}>
          <div style={styles.priceBox}>
            <span style={styles.priceLabel}>本项金额</span>
            <span style={styles.priceValue}>RM {total}</span>
            {template.fields.quantity ? (
              <span style={styles.priceSub}>
                RM {unitPrice} × {quantity}
              </span>
            ) : null}
          </div>
          <div style={styles.footerButtons}>
            <button type="button" style={styles.ghostButton} onClick={onCancel}>
              取消
            </button>
            <button type="button" style={styles.primaryButton} onClick={handleSave}>
              {isEdit ? "保存修改" : "加入清单"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function RowList({
  label,
  addLabel,
  placeholder,
  values,
  max,
  onChange,
}: {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  max: number;
  onChange: (values: string[]) => void;
}) {
  const rows = values.length ? values : [""];
  function update(index: number, value: string) {
    onChange(rows.map((entry, i) => (i === index ? value : entry)));
  }
  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length ? next : []);
  }
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <div style={styles.rows}>
        {rows.map((value, index) => (
          <div key={index} style={styles.row}>
            <input
              style={styles.input}
              value={value}
              placeholder={`${placeholder} ${index + 1}`}
              onChange={(event) => update(index, event.target.value)}
            />
            {rows.length > 1 || value ? (
              <button type="button" style={styles.rowRemove} onClick={() => remove(index)} aria-label="移除">
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {rows.length < max ? (
        <button type="button" style={styles.addRow} onClick={() => onChange([...rows, ""])}>
          + {addLabel}
        </button>
      ) : null}
    </div>
  );
}

function PairRowList({
  nameLabel,
  deceaseds,
  relations,
  relationOptions,
  max,
  onChange,
}: {
  nameLabel: string;
  deceaseds: string[];
  relations: string[];
  relationOptions: string[];
  max: number;
  onChange: (deceaseds: string[], relations: string[]) => void;
}) {
  const count = Math.max(deceaseds.length, relations.length, 1);
  const rows = Array.from({ length: count }, (_, i) => ({
    deceased: deceaseds[i] ?? "",
    relation: relations[i] ?? "",
  }));
  function update(index: number, key: "deceased" | "relation", value: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    onChange(next.map((r) => r.deceased), next.map((r) => r.relation));
  }
  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.map((r) => r.deceased), next.map((r) => r.relation));
  }
  function add() {
    onChange([...rows.map((r) => r.deceased), ""], [...rows.map((r) => r.relation), ""]);
  }
  return (
    <div style={styles.field}>
      <label style={styles.label}>{nameLabel}资料（关系 + 名字）</label>
      <div style={styles.rows}>
        {rows.map((row, index) => (
          <div key={index} style={styles.pairCard}>
            <div style={styles.pairHead}>
              <span style={styles.pairIndex}>{nameLabel} {index + 1}</span>
              {rows.length > 1 || row.deceased || row.relation ? (
                <button type="button" style={styles.rowRemove} onClick={() => remove(index)} aria-label="移除">
                  ✕
                </button>
              ) : null}
            </div>
            <select
              style={styles.select}
              value={row.relation}
              onChange={(event) => update(index, "relation", event.target.value)}
            >
              <option value="">选择关系…</option>
              {row.relation && !relationOptions.includes(row.relation) ? (
                <option value={row.relation}>{row.relation}</option>
              ) : null}
              {relationOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <input
              style={styles.input}
              value={row.deceased}
              placeholder={`${nameLabel}名字`}
              onChange={(event) => update(index, "deceased", event.target.value)}
            />
          </div>
        ))}
      </div>
      {rows.length < max ? (
        <button type="button" style={styles.addRow} onClick={add}>
          + 添加{nameLabel}
        </button>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <input
        style={styles.input}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.5)",
    padding: 0,
  },
  panel: {
    width: "min(520px, 100%)",
    maxHeight: "94vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--x-color-panel)",
    borderTopLeftRadius: "20px",
    borderTopRightRadius: "20px",
    boxShadow: "0 -20px 60px var(--x-color-shadow)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px",
    borderBottom: "1px solid var(--x-color-line-soft)",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    cursor: "pointer",
    fontSize: "14px",
  },
  body: {
    padding: "16px 18px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-ink)",
  },
  hint: {
    margin: 0,
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
    lineHeight: 1.5,
  },
  select: {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    fontSize: "15px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    fontSize: "15px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    minHeight: "70px",
    resize: "vertical",
    padding: "11px 12px",
    fontSize: "14px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  rowRemove: {
    flexShrink: 0,
    width: 34,
    height: 34,
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    cursor: "pointer",
    fontSize: "13px",
  },
  addRow: {
    alignSelf: "flex-start",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
    borderRadius: "999px",
    cursor: "pointer",
  },
  pairCard: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
  },
  pairHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pairIndex: {
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--x-color-ink-muted)",
  },
  error: {
    margin: "0 18px",
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    border: "1px solid var(--x-color-danger-border)",
    fontSize: "13px",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "14px 18px",
    borderTop: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
  },
  priceBox: {
    display: "flex",
    flexDirection: "column",
    lineHeight: 1.2,
  },
  priceLabel: {
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
  },
  priceValue: {
    fontSize: "18px",
    fontWeight: 800,
    color: "var(--x-color-accent-strong)",
  },
  priceSub: {
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
  },
  footerButtons: {
    display: "flex",
    gap: "10px",
  },
  ghostButton: {
    padding: "11px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--x-color-ink-muted)",
    background: "transparent",
    border: "1px solid var(--x-color-line)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  primaryButton: {
    padding: "11px 20px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
};
