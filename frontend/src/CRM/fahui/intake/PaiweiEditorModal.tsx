import { useState, type CSSProperties } from "react";

import {
  arrayToLines,
  getDraftQuantity,
  getDraftTotalPrice,
  getDraftUnitPrice,
  getTemplate,
  isWuyuanCode,
  linesToArray,
  paiweiFieldLabel,
  selectableTemplates,
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
// 无缘子女（A3/B3）的阳上最多 2 位（父 + 母）—— 不看登录状态，公开端与 CRM 一样
const MAX_WUYUAN_OWNER_ROWS = 2;
const MAX_DECEASED = 6;

function deceasedLabel(code: PaiweiCode): string {
  return code === "A3" || code === "B3" ? "子女" : "对象";
}

type PaiweiEditorModalProps = {
  initialDraft: PaiweiDraft;
  isEdit: boolean;
  relationOptions?: string[];
  /** 覆盖保存按钮文案；默认「保存修改 / 加入清单」。 */
  saveLabel?: string;
  /** 关闭后不渲染「添加阳上 / 添加对象」等加行按钮（公众端停止新增时用）。 */
  allowAddRows?: boolean;
  onCancel: () => void;
  /** 返回 Promise 时弹窗会显示保存中状态，reject 的错误信息会展示在弹窗内。 */
  onSave: (draft: PaiweiDraft) => void | Promise<void>;
};

export function PaiweiEditorModal({
  initialDraft,
  isEdit,
  relationOptions = [],
  saveLabel,
  allowAddRows = true,
  onCancel,
  onSave,
}: PaiweiEditorModalProps) {
  const [draft, setDraft] = useState<PaiweiDraft>(initialDraft);
  const [owners, setOwners] = useState<string[]>(() => initRows(initialDraft.owner));
  // 无缘子女：阳上一行 = 名字 + 身份（父 / 母 / 留空），保存时拆回 owner / father / mother
  const [ownerRoleRows, setOwnerRoleRows] = useState<OwnerRoleRow[]>(() => buildOwnerRoleRows(initialDraft));
  const [deceaseds, setDeceaseds] = useState<string[]>(() => initRows(initialDraft.deceased));
  const [relations, setRelations] = useState<string[]>(() => initRows(initialDraft.relation));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const template = getTemplate(draft.code);

  function patch(next: Partial<PaiweiDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setError("");
  }

  function changeCode(code: PaiweiCode) {
    // 切到/切离无缘子女，阳上那几行的结构不同，重新拼一次
    setOwnerRoleRows(buildOwnerRoleRows({ ...draft, code }));
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
    if (isWuyuanCode(draft.code)) {
      const rows = ownerRoleRows.filter((row) => row.name.trim());
      return {
        ...draft,
        owner: arrayToLines(rows.filter((row) => !row.role).map((row) => row.name.trim())),
        father: rows.find((row) => row.role === "father")?.name.trim() || "",
        mother: rows.find((row) => row.role === "mother")?.name.trim() || "",
        deceased: template.fields.deceased ? arrayToLines(deceaseds) : "",
        relation: "",
      };
    }
    return {
      ...draft,
      owner: template.fields.owner ? arrayToLines(owners) : "",
      deceased: template.fields.deceased ? arrayToLines(deceaseds) : "",
      relation: template.fields.relation ? arrayToLines(relations) : "",
    };
  }

  async function handleSave() {
    if (isWuyuanCode(draft.code)) {
      for (const [role, label] of [["father", "父"], ["mother", "母"]] as const) {
        const hit = ownerRoleRows.filter((row) => row.role === role && row.name.trim());
        if (hit.length > 1) {
          setError(`「${label}」只能填一位`);
          return;
        }
      }
    }
    const finalDraft = buildFinalDraft();
    const validationError = validateDraft(finalDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const result = onSave(finalDraft);
    if (result instanceof Promise) {
      setSaving(true);
      try {
        await result;
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "保存失败");
      } finally {
        setSaving(false);
      }
    }
  }

  const unitPrice = getDraftUnitPrice(draft);
  const quantity = getDraftQuantity(draft);
  const total = getDraftTotalPrice(draft);

  return (
    <div style={styles.overlay} onClick={saving ? undefined : onCancel}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <h3 style={styles.title}>{isEdit ? "编辑牌位" : "添加牌位"}</h3>
          <button type="button" style={styles.closeButton} onClick={onCancel} aria-label="关闭" disabled={saving}>
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
              {selectableTemplates(draft.code).map((tpl) => (
                <option key={tpl.code} value={tpl.code}>
                  {`${tpl.title} · RM ${tpl.price}`}
                </option>
              ))}
            </select>
            <p style={styles.hint}>{template.hint}</p>
          </div>

          {template.customPrice ? (
            <div style={styles.field}>
              <label style={styles.label}>金额 (RM)</label>
              <input
                style={styles.input}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={draft.amount}
                placeholder="例如 50"
                onChange={(event) => patch({ amount: event.target.value.replace(/[^\d.]/g, "") })}
              />
              <p style={styles.hint}>随缘乐捐，金额自订；不需要填姓名，也不会印牌位。</p>
            </div>
          ) : null}

          {!template.customPrice && template.fields.owner && isWuyuanCode(draft.code) ? (
            <OwnerRoleRowList
              rows={ownerRoleRows}
              max={MAX_WUYUAN_OWNER_ROWS}
              onChange={(next) => {
                setOwnerRoleRows(next);
                setError("");
              }}
            />
          ) : template.fields.owner ? (
            <RowList
              label="阳上姓名"
              addLabel="添加阳上姓名"
              placeholder="阳上"
              values={owners}
              max={allowAddRows ? (draft.code === "C" ? 1 : MAX_OWNERS) : 1}
              onChange={setOwners}
            />
          ) : null}

          {template.fields.deceased && template.fields.relation ? (
            <PairRowList
              nameLabel={deceasedLabel(draft.code)}
              deceaseds={deceaseds}
              relations={relations}
              relationOptions={relationOptions}
              max={allowAddRows ? MAX_DECEASED : 1}
              onChange={updatePairs}
            />
          ) : template.fields.deceased ? (
            <RowList
              label={`${deceasedLabel(draft.code)}姓名`}
              addLabel={`添加${deceasedLabel(draft.code)}`}
              placeholder={deceasedLabel(draft.code)}
              values={deceaseds}
              max={allowAddRows ? MAX_DECEASED : 1}
              onChange={setDeceaseds}
            />
          ) : null}

          {template.fields.surname ? (
            <TextField label="姓氏" value={draft.surname} placeholder="例如：陈" onChange={(v) => patch({ surname: v })} />
          ) : null}
          {template.fields.suffix ? (
            // 堂号固定为打印模板的「门堂上历代祖先」，不允许修改。
            <TextField label="堂号 / 内容" value={draft.suffix} placeholder="门堂上历代祖先" readOnly onChange={() => {}} />
          ) : null}
          {template.fields.father && !isWuyuanCode(draft.code) ? (
            <TextField
              label={paiweiFieldLabel("father", draft.code)}
              value={draft.father}
              placeholder={isWuyuanCode(draft.code) ? "在生父亲名讳" : "先父名讳"}
              onChange={(v) => patch({ father: v })}
            />
          ) : null}
          {template.fields.mother && !isWuyuanCode(draft.code) ? (
            <TextField
              label={paiweiFieldLabel("mother", draft.code)}
              value={draft.mother}
              placeholder={isWuyuanCode(draft.code) ? "在生母亲名讳" : "先母名讳"}
              onChange={(v) => patch({ mother: v })}
            />
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
            <button type="button" style={styles.ghostButton} onClick={onCancel} disabled={saving}>
              取消
            </button>
            <button
              type="button"
              style={{ ...styles.primaryButton, ...(saving ? { opacity: 0.6, cursor: "default" } : null) }}
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "保存中…" : saveLabel ?? (isEdit ? "保存修改" : "加入清单")}
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

type OwnerRoleRow = { name: string; role: "" | "father" | "mother" };

/** 从 draft 拼出阳上行：先是没有身份的阳上，再是父、母；至少留一行空的。 */
function buildOwnerRoleRows(draft: PaiweiDraft): OwnerRoleRow[] {
  if (!isWuyuanCode(draft.code)) {
    return [{ name: "", role: "" }];
  }
  const rows: OwnerRoleRow[] = initRows(draft.owner)
    .filter((name) => name.trim())
    .map((name) => ({ name, role: "" as const }));
  if (draft.father?.trim()) rows.push({ name: draft.father.trim(), role: "father" });
  if (draft.mother?.trim()) rows.push({ name: draft.mother.trim(), role: "mother" });
  return rows.length ? rows.slice(0, MAX_WUYUAN_OWNER_ROWS) : [{ name: "", role: "" }];
}

/** 无缘子女的阳上：一行一个名字 + 身份下拉（父 / 母 / 留空）。 */
function OwnerRoleRowList({
  rows,
  max,
  onChange,
}: {
  rows: OwnerRoleRow[];
  max: number;
  onChange: (rows: OwnerRoleRow[]) => void;
}) {
  const list = rows.length ? rows : [{ name: "", role: "" as const }];

  function update(index: number, patch: Partial<OwnerRoleRow>) {
    onChange(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div style={styles.field}>
      <label style={styles.label}>阳上（在生者）</label>
      <div style={styles.rows}>
        {list.map((row, index) => (
          <div key={index} style={styles.row}>
            {/* 先选身份再填名字：读起来就是「父 ○○」「母 ○○」，和牌位印出来的顺序一致 */}
            <select
              style={{ ...styles.select, width: 96, flexShrink: 0 }}
              value={row.role}
              onChange={(event) => update(index, { role: event.target.value as OwnerRoleRow["role"] })}
            >
              <option value="">阳上</option>
              <option value="father">父</option>
              <option value="mother">母</option>
            </select>
            <input
              style={{ ...styles.input, flex: 1 }}
              value={row.name}
              placeholder="姓名"
              onChange={(event) => update(index, { name: event.target.value })}
            />
            {list.length > 1 ? (
              <button
                type="button"
                style={styles.rowRemove}
                aria-label="移除这一行"
                onClick={() => onChange(list.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {list.length < max ? (
        <button type="button" style={styles.addRow} onClick={() => onChange([...list, { name: "", role: "" }])}>
          添加一行（最多 {max} 行）
        </button>
      ) : null}
      <p style={styles.hint}>无缘子女的父母是在生的阳上，牌位会印成「阳上 父 ○○ / 母 ○○」。</p>
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
      <label style={styles.label}>{nameLabel}（关系 + 名字）</label>
      <div style={styles.rows}>
        {/* 和无缘子女的阳上同一套排版：一行 = 关系下拉 + 名字，干净好扫 */}
        {rows.map((row, index) => (
          <div key={index} style={styles.row}>
            <select
              style={{ ...styles.select, width: 110, flexShrink: 0 }}
              value={row.relation}
              onChange={(event) => update(index, "relation", event.target.value)}
            >
              <option value="">关系…</option>
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
              style={{ ...styles.input, flex: 1 }}
              value={row.deceased}
              placeholder={`${nameLabel}名字`}
              onChange={(event) => update(index, "deceased", event.target.value)}
            />
            {rows.length > 1 ? (
              <button type="button" style={styles.rowRemove} onClick={() => remove(index)} aria-label="移除这一行">
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {rows.length < max ? (
        <button type="button" style={styles.addRow} onClick={add}>
          添加一行（最多 {max} 行）
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
  readOnly = false,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      <input
        style={{
          ...styles.input,
          ...(readOnly ? { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" } : null),
        }}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
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
