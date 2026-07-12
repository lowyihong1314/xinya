import { CSSProperties, FormEvent, useCallback, useEffect, useState } from "react";

import { EmailLogItem, listEmails, sendEmail } from "./api";

const EMAIL_DOMAIN = "utba.my";

const EMPTY_FORM = { to_email: "", subject: "", body: "", cc_email: "", bcc_email: "" };

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusMeta(status: string): { label: string; tone: "success" | "danger" | "warning" } {
  if (status === "success") {
    return { label: "已发送", tone: "success" };
  }
  if (status === "failed") {
    return { label: "失败", tone: "danger" };
  }
  return { label: "处理中", tone: "warning" };
}

export function EmailPanel({
  isMobile,
  username,
  displayName,
}: {
  isMobile: boolean;
  username: string;
  displayName: string;
}) {
  const [emails, setEmails] = useState<EmailLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fromEmail, setFromEmail] = useState(`${username}@${EMAIL_DOMAIN}`);
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listEmails();
      setEmails(result.data || []);
      if (result.from_email) {
        setFromEmail(result.from_email);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载邮件失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCompose() {
    setNotice(null);
    setError(null);
    setForm(EMPTY_FORM);
    setShowCompose(true);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await sendEmail({
        to_email: form.to_email.trim(),
        subject: form.subject.trim(),
        body: form.body,
        cc_email: form.cc_email.trim() || undefined,
        bcc_email: form.bcc_email.trim() || undefined,
      });
      setNotice("邮件已发送");
      setShowCompose(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={wrapStyle}>
      <div style={toolbarStyle}>
        <div style={fromLineStyle}>
          发件邮箱：<strong style={fromEmailStyle}>{fromEmail}</strong>
        </div>
        <button type="button" style={newEmailButtonStyle} onClick={openCompose}>
          ✚ 新建邮件
        </button>
      </div>

      {notice ? <div style={noticeStyle}>{notice}</div> : null}
      {error ? <div style={errorStyle}>{error}</div> : null}

      {loading ? (
        <div style={stateStyle}>正在加载邮件…</div>
      ) : emails.length === 0 ? (
        <div style={stateStyle}>还没有发送过邮件。点击「新建邮件」开始。</div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>收件人</th>
                <th style={thStyle}>主题</th>
                <th style={thStyle}>时间</th>
                <th style={thRightStyle}>状态</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((item) => {
                const meta = statusMeta(item.status);
                return (
                  <tr key={item.id}>
                    <td style={tdStrongStyle}>{item.to_email}</td>
                    <td style={tdStyle}>{item.subject || "(无主题)"}</td>
                    <td style={tdMutedStyle}>{formatDateTime(item.created_at)}</td>
                    <td style={tdRightStyle}>
                      <span style={chipStyle(meta.tone)} title={item.error_message || undefined}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCompose ? (
        <div style={overlayStyle} onClick={() => (sending ? null : setShowCompose(false))}>
          <div style={modalCardStyle(isMobile)} onClick={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={modalTitleStyle}>新建邮件</h3>
              <button
                type="button"
                style={closeButtonStyle}
                onClick={() => setShowCompose(false)}
                aria-label="关闭"
                disabled={sending}
              >
                ✕
              </button>
            </div>

            <form style={formStyle} onSubmit={handleSend}>
              <div style={rowStyle}>
                <span style={labelStyle}>发件人</span>
                <div style={readonlyValueStyle}>
                  {displayName} &lt;{fromEmail}&gt;
                </div>
              </div>

              <label style={rowStyle}>
                <span style={labelStyle}>收件人</span>
                <input
                  type="email"
                  required
                  value={form.to_email}
                  onChange={(event) => updateForm("to_email", event.target.value)}
                  placeholder="recipient@example.com"
                  style={inputStyle}
                />
              </label>

              <label style={rowStyle}>
                <span style={labelStyle}>抄送 (CC)</span>
                <input
                  type="email"
                  value={form.cc_email}
                  onChange={(event) => updateForm("cc_email", event.target.value)}
                  placeholder="可选"
                  style={inputStyle}
                />
              </label>

              <label style={rowStyle}>
                <span style={labelStyle}>密送 (BCC)</span>
                <input
                  type="email"
                  value={form.bcc_email}
                  onChange={(event) => updateForm("bcc_email", event.target.value)}
                  placeholder="可选"
                  style={inputStyle}
                />
              </label>

              <label style={rowStyle}>
                <span style={labelStyle}>主题</span>
                <input
                  type="text"
                  required
                  value={form.subject}
                  onChange={(event) => updateForm("subject", event.target.value)}
                  placeholder="邮件主题"
                  style={inputStyle}
                />
              </label>

              <label style={bodyRowStyle}>
                <span style={labelStyle}>内容</span>
                <textarea
                  required
                  rows={9}
                  value={form.body}
                  onChange={(event) => updateForm("body", event.target.value)}
                  placeholder="请输入邮件内容…"
                  style={textareaStyle}
                />
              </label>

              {error ? <div style={errorStyle}>{error}</div> : null}

              <div style={modalActionsStyle}>
                <button
                  type="button"
                  style={ghostButtonStyle}
                  onClick={() => setShowCompose(false)}
                  disabled={sending}
                >
                  取消
                </button>
                <button type="submit" style={sendButtonStyle} disabled={sending}>
                  {sending ? "发送中…" : "发送邮件"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
};

const fromLineStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const fromEmailStyle: CSSProperties = {
  color: "var(--x-color-ink)",
};

const newEmailButtonStyle: CSSProperties = {
  padding: "9px 16px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, rgba(15,118,110,0.95), rgba(13,148,136,0.95))",
  color: "white",
  fontWeight: 800,
  fontSize: "13px",
  cursor: "pointer",
};

const noticeStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
  fontSize: "13px",
};

const errorStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontSize: "13px",
};

const stateStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "12px",
  background: "rgba(245,248,251,0.9)",
  border: "1px solid rgba(216,223,235,0.9)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  textAlign: "center",
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid rgba(216,223,235,0.9)",
  borderRadius: "12px",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  minWidth: "520px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  background: "rgba(245,248,251,0.9)",
  borderBottom: "1px solid rgba(216,223,235,0.9)",
  whiteSpace: "nowrap",
};

const thRightStyle: CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(216,223,235,0.6)",
  color: "var(--x-color-ink)",
  verticalAlign: "middle",
};

const tdStrongStyle: CSSProperties = { ...tdStyle, fontWeight: 700 };

const tdMutedStyle: CSSProperties = { ...tdStyle, color: "var(--x-color-ink-muted)", whiteSpace: "nowrap" };

const tdRightStyle: CSSProperties = { ...tdStyle, textAlign: "right", whiteSpace: "nowrap" };

function chipStyle(tone: "success" | "danger" | "warning"): CSSProperties {
  const palette =
    tone === "success"
      ? { bg: "rgba(15,118,110,0.12)", color: "var(--x-color-accent-strong)" }
      : tone === "danger"
        ? { bg: "rgba(194,65,12,0.12)", color: "var(--x-color-danger)" }
        : { bg: "rgba(202,138,4,0.14)", color: "#a16207" };
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background: palette.bg,
    color: palette.color,
    whiteSpace: "nowrap",
  };
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.42)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 5000,
  backdropFilter: "blur(2px)",
};

function modalCardStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: isMobile ? "100%" : "540px",
    maxHeight: "90vh",
    overflowY: "auto",
    background: "#fff",
    borderRadius: "16px",
    border: "1px solid rgba(216,223,235,0.9)",
    boxShadow: "0 24px 60px rgba(15,23,42,0.24)",
    padding: isMobile ? "16px" : "20px",
    display: "grid",
    gap: "14px",
  };
}

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "18px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const closeButtonStyle: CSSProperties = {
  width: "30px",
  height: "30px",
  borderRadius: "8px",
  border: "1px solid rgba(216,223,235,0.9)",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
  fontSize: "14px",
  lineHeight: 1,
};

const formStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const bodyRowStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const labelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(203,213,225,0.9)",
  fontSize: "14px",
  boxSizing: "border-box",
  color: "var(--x-color-ink)",
  background: "#fff",
};

const readonlyValueStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(216,223,235,0.9)",
  background: "rgba(245,248,251,0.9)",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  overflowWrap: "anywhere",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  lineHeight: 1.6,
  fontFamily: "inherit",
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};

const ghostButtonStyle: CSSProperties = {
  padding: "10px 18px",
  borderRadius: "999px",
  border: "1px solid rgba(203,213,225,0.9)",
  background: "white",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const sendButtonStyle: CSSProperties = {
  padding: "10px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, rgba(15,118,110,0.95), rgba(13,148,136,0.95))",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};
