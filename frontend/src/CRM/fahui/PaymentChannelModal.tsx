import { useEffect, useState, type CSSProperties } from "react";

import { API_BASE } from "../../js/apiBase";
import { show_alert } from "../../js/show_alert";
import { showConfirmDialog } from "../../js/dialogs";
import {
  createYlpPaymentChannel,
  deleteYlpPaymentChannel,
  listYlpPaymentChannels,
  updateYlpPaymentChannel,
} from "./api";
import type { YlpPaymentChannel } from "./types";

type ChannelType = "qr" | "bank";

type FormState = {
  channel_type: ChannelType;
  label: string;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
  note: string;
  qrFile: File | null;
  existingQr: string | null;
};

function emptyForm(): FormState {
  return {
    channel_type: "qr",
    label: "",
    bank_name: "",
    bank_account_no: "",
    bank_account_name: "",
    note: "",
    qrFile: null,
    existingQr: null,
  };
}

function resolveQr(path?: string | null): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE}${path}` : path;
}

export function PaymentChannelModal({ version, onClose }: { version: string; onClose: () => void }) {
  const [channels, setChannels] = useState<YlpPaymentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null | "new">(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const res = await listYlpPaymentChannels(version);
      setChannels(res.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  function openNew() {
    setForm(emptyForm());
    setEditingId("new");
    setError("");
  }

  function openEdit(channel: YlpPaymentChannel) {
    setForm({
      channel_type: channel.channel_type,
      label: channel.label || "",
      bank_name: channel.bank_name || "",
      bank_account_no: channel.bank_account_no || "",
      bank_account_name: channel.bank_account_name || "",
      note: channel.note || "",
      qrFile: null,
      existingQr: channel.qr_image_path || null,
    });
    setEditingId(channel.id);
    setError("");
  }

  function patch(next: Partial<FormState>) {
    setForm((current) => ({ ...current, ...next }));
    setError("");
  }

  async function handleSave() {
    if (form.channel_type === "qr" && !form.qrFile && !form.existingQr) {
      setError("扫码支付需要上传二维码");
      return;
    }
    if (form.channel_type === "bank" && !form.bank_account_no.trim()) {
      setError("银行转账需要填写帐号");
      return;
    }
    const data = new FormData();
    data.append("version", version);
    data.append("channel_type", form.channel_type);
    data.append("label", form.label.trim());
    data.append("note", form.note.trim());
    if (form.channel_type === "bank") {
      data.append("bank_name", form.bank_name.trim());
      data.append("bank_account_no", form.bank_account_no.trim());
      data.append("bank_account_name", form.bank_account_name.trim());
    } else if (form.qrFile) {
      data.append("qr_image", form.qrFile);
    }

    setSaving(true);
    setError("");
    try {
      if (editingId === "new") {
        await createYlpPaymentChannel(data);
      } else if (typeof editingId === "number") {
        await updateYlpPaymentChannel(editingId, data);
      }
      setEditingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(channel: YlpPaymentChannel) {
    const ok = await showConfirmDialog({ message: "确认删除这个支付方式？", tone: "danger" });
    if (!ok) return;
    try {
      await deleteYlpPaymentChannel(channel.id);
      await reload();
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "删除失败");
    }
  }

  const editing = editingId !== null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <div>
            <h3 style={styles.title}>配置支付路径</h3>
            <p style={styles.subtitle}>{version.replace("_YLP", "")} 年 · 扫码支付 / 银行转账</p>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div style={styles.body}>
          {error ? <div style={styles.errorBox}>{error}</div> : null}

          {editing ? (
            <div style={styles.formCard}>
              <div style={styles.typeToggle}>
                {(["qr", "bank"] as ChannelType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    style={{ ...styles.typeButton, ...(form.channel_type === type ? styles.typeButtonActive : {}) }}
                    onClick={() => patch({ channel_type: type })}
                  >
                    {type === "qr" ? "扫码支付" : "银行转账"}
                  </button>
                ))}
              </div>

              <label style={styles.label}>名称（选填）</label>
              <input
                style={styles.input}
                placeholder={form.channel_type === "qr" ? "例如：Maybank 收款码" : "例如：大众银行"}
                value={form.label}
                onChange={(event) => patch({ label: event.target.value })}
              />

              {form.channel_type === "qr" ? (
                <>
                  <label style={styles.label}>收款二维码</label>
                  {form.qrFile || form.existingQr ? (
                    <img
                      src={form.qrFile ? URL.createObjectURL(form.qrFile) : resolveQr(form.existingQr)}
                      alt="收款码"
                      style={styles.qrPreview}
                    />
                  ) : null}
                  <input
                    style={styles.fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.heic,.heif"
                    onChange={(event) => patch({ qrFile: event.target.files?.[0] ?? null })}
                  />
                </>
              ) : (
                <>
                  <label style={styles.label}>银行名称</label>
                  <input
                    style={styles.input}
                    placeholder="例如：Public Bank"
                    value={form.bank_name}
                    onChange={(event) => patch({ bank_name: event.target.value })}
                  />
                  <label style={styles.label}>银行帐号 *</label>
                  <input
                    style={styles.input}
                    placeholder="帐号号码"
                    value={form.bank_account_no}
                    onChange={(event) => patch({ bank_account_no: event.target.value })}
                  />
                  <label style={styles.label}>户名</label>
                  <input
                    style={styles.input}
                    placeholder="收款人姓名"
                    value={form.bank_account_name}
                    onChange={(event) => patch({ bank_account_name: event.target.value })}
                  />
                </>
              )}

              <label style={styles.label}>备注（选填）</label>
              <input
                style={styles.input}
                placeholder="其他付款说明"
                value={form.note}
                onChange={(event) => patch({ note: event.target.value })}
              />

              <div style={styles.formButtons}>
                <button type="button" style={styles.ghostButton} onClick={() => setEditingId(null)} disabled={saving}>
                  取消
                </button>
                <button
                  type="button"
                  style={{ ...styles.primaryButton, ...(saving ? styles.disabled : {}) }}
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? "保存中…" : editingId === "new" ? "添加" : "保存"}
                </button>
              </div>
            </div>
          ) : (
            <>
              {loading ? (
                <p style={styles.muted}>加载中…</p>
              ) : channels.length ? (
                <div style={styles.list}>
                  {channels.map((channel) => (
                    <div key={channel.id} style={styles.channelCard}>
                      <div style={styles.channelMain}>
                        <div style={styles.channelTop}>
                          <span
                            style={{
                              ...styles.typeBadge,
                              ...(channel.channel_type === "qr" ? styles.badgeQr : styles.badgeBank),
                            }}
                          >
                            {channel.channel_type === "qr" ? "扫码支付" : "银行转账"}
                          </span>
                          <span style={styles.channelLabel}>{channel.label || "未命名"}</span>
                        </div>
                        {channel.channel_type === "qr" ? (
                          channel.qr_image_path ? (
                            <img src={resolveQr(channel.qr_image_path)} alt="收款码" style={styles.qrThumb} />
                          ) : (
                            <span style={styles.muted}>未上传二维码</span>
                          )
                        ) : (
                          <div style={styles.bankInfo}>
                            <span>{channel.bank_name || "-"}</span>
                            <span style={styles.bankAcc}>{channel.bank_account_no || "-"}</span>
                            <span>{channel.bank_account_name || ""}</span>
                          </div>
                        )}
                        {channel.note ? <span style={styles.muted}>{channel.note}</span> : null}
                      </div>
                      <div style={styles.channelActions}>
                        <button type="button" style={styles.smallButton} onClick={() => openEdit(channel)}>
                          编辑
                        </button>
                        <button type="button" style={styles.smallDanger} onClick={() => void handleDelete(channel)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={styles.emptyHint}>还没有配置支付方式，点下方按钮添加。</p>
              )}

              <button type="button" style={styles.addButton} onClick={openNew}>
                + 添加支付方式
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.55)",
    padding: "16px",
  },
  panel: {
    width: "min(520px, 100%)",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--x-color-panel)",
    borderRadius: "var(--x-radius-lg)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "16px 18px",
    borderBottom: "1px solid var(--x-color-line-soft)",
  },
  title: { margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--x-color-ink)" },
  subtitle: { margin: "3px 0 0", fontSize: "12px", color: "var(--x-color-ink-muted)" },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    cursor: "pointer",
    fontSize: "14px",
    flexShrink: 0,
  },
  body: { padding: "16px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" },
  errorBox: {
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    border: "1px solid var(--x-color-danger-border)",
    fontSize: "13px",
  },
  muted: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  list: { display: "flex", flexDirection: "column", gap: "10px" },
  channelCard: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "10px",
    padding: "12px 14px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  channelMain: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: 1 },
  channelTop: { display: "flex", alignItems: "center", gap: "8px" },
  typeBadge: { padding: "2px 9px", borderRadius: "999px", fontSize: "11px", fontWeight: 700 },
  badgeQr: { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" },
  badgeBank: { background: "var(--x-color-info-soft)", color: "var(--x-color-info)" },
  channelLabel: { fontSize: "14px", fontWeight: 700, color: "var(--x-color-ink)" },
  qrThumb: { width: 88, height: 88, objectFit: "contain", borderRadius: "8px", border: "1px solid var(--x-color-line)", background: "#fff" },
  bankInfo: { display: "flex", flexDirection: "column", gap: "2px", fontSize: "13px", color: "var(--x-color-ink)" },
  bankAcc: { fontWeight: 700, fontFamily: "var(--x-font-mono)" },
  channelActions: { display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 },
  smallButton: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-accent-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  smallDanger: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--x-color-danger)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-danger-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  emptyHint: {
    margin: 0,
    padding: "16px",
    textAlign: "center",
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
    background: "var(--x-color-panel-alt)",
    borderRadius: "var(--x-radius-sm)",
    border: "1px dashed var(--x-color-line)",
  },
  addButton: {
    width: "100%",
    padding: "12px",
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-accent-soft)",
    border: "1px dashed var(--x-color-accent-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  formCard: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
  },
  typeToggle: { display: "flex", gap: "8px", marginBottom: "4px" },
  typeButton: {
    flex: 1,
    padding: "10px",
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-ink-muted)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  typeButtonActive: {
    color: "#fff",
    background: "var(--x-color-accent)",
    borderColor: "var(--x-color-accent)",
  },
  label: { fontSize: "12px", fontWeight: 600, color: "var(--x-color-ink)", marginTop: "2px" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: "14px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  fileInput: {
    width: "100%",
    boxSizing: "border-box",
    fontSize: "13px",
    padding: "8px 10px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px dashed var(--x-color-line)",
    background: "var(--x-color-panel)",
  },
  qrPreview: {
    width: 140,
    height: 140,
    objectFit: "contain",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "#fff",
    alignSelf: "flex-start",
  },
  formButtons: { display: "flex", gap: "10px", marginTop: "6px" },
  ghostButton: {
    flex: 1,
    padding: "11px",
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--x-color-ink-muted)",
    background: "transparent",
    border: "1px solid var(--x-color-line)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  primaryButton: {
    flex: 1,
    padding: "11px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  disabled: { opacity: 0.55, cursor: "not-allowed" },
};
