import { useState } from "react";
import type { CSSProperties } from "react";

import { openOverlay } from "../app/OverlayProvider";
import { CachedImage } from "../components/CachedMedia";
import { apiFetch } from "./apiFetch";
import { clearVerifiedPhone, correctPhoneInputMY, formatPhoneForInput, getSavedVerifiedPhone, normalizePhoneMY, saveVerifiedPhone } from "./phone";
import { show_alert } from "./show_alert";

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { message?: string }).message || "请求失败");
  }
  return data as { status?: string; message?: string };
}

function PhoneVerificationModal({
  onResolve,
  initialPhone,
  poster,
}: {
  onResolve: (phone: string) => void;
  initialPhone?: string;
  poster?: string | null;
}) {
  const [phoneInput, setPhoneInput] = useState(() => formatPhoneForInput(initialPhone || ""));
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [callVisible, setCallVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function sendOtp(channel: "sms" | "call" = "sms") {
    const phone = normalizePhoneMY(phoneInput);
    if (!phone) {
      show_alert("error", "请输入正确的马来西亚手机号码");
      return;
    }

    const formData = new FormData();
    formData.append("phone", phone);
    formData.append("channel", channel);

    setSending(true);
    try {
      const payload = await parseJson(
        await apiFetch("/api/twilio/send_otp", {
          method: "POST",
          body: formData,
        }),
      );

      if (payload.status === "cookie_true") {
        saveVerifiedPhone(phone);
        show_alert("success", payload.message || "验证成功");
        onResolve(phone);
        return;
      }

      setOtpSent(true);
      setCallVisible(channel === "sms");
      show_alert("success", channel === "call" ? "语音电话拨打中，请留意来电" : "验证码已发送，请查收短信");
    } catch (error) {
      show_alert("error", error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    const phone = normalizePhoneMY(phoneInput);
    const otp = otpInput.trim();
    if (!phone) {
      show_alert("error", "请输入正确的马来西亚手机号码");
      return;
    }
    if (!otp) {
      show_alert("error", "请输入验证码");
      return;
    }

    setVerifying(true);
    try {
      await parseJson(
        await apiFetch("/api/twilio/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, otp }),
        }),
      );

      saveVerifiedPhone(phone);
      onResolve(phone);
    } catch (error) {
      if (otp === "991031") {
        clearVerifiedPhone();
      }
      show_alert("error", error instanceof Error ? error.message : "验证失败");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <header style={headStyle}>
          <p style={eyebrowStyle}>身份验证</p>
          <h3 style={titleStyle}>手机号验证</h3>
          <p style={subtitleStyle}>验证手机号后，即可登记并随时用同一号码查回记录</p>
        </header>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="phone-verify-input">
            手机号码
          </label>
          <input
            id="phone-verify-input"
            type="tel"
            placeholder="例如 012-345 6789"
            value={phoneInput}
            onChange={(event) => setPhoneInput(correctPhoneInputMY(event.target.value))}
            onBlur={() => setPhoneInput((current) => formatPhoneForInput(current))}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="phone-verify-otp">
            短信验证码
          </label>
          <input
            id="phone-verify-otp"
            type="tel"
            placeholder="6 位验证码"
            value={otpInput}
            onChange={(event) => setOtpInput(event.target.value.replace(/\s+/g, ""))}
            style={inputStyle}
          />
        </div>

        <button type="button" style={{ ...primaryButtonStyle, ...(sending ? disabledStyle : null) }} disabled={sending} onClick={() => void sendOtp("sms")}>
          {sending ? "发送中…" : otpSent ? "重新发送验证码" : "发送短信验证码"}
        </button>

        {callVisible ? (
          <button type="button" style={{ ...ghostButtonStyle, ...(sending ? disabledStyle : null) }} disabled={sending} onClick={() => void sendOtp("call")}>
            收不到短信？改用语音电话验证
          </button>
        ) : null}

        <button type="button" style={{ ...accentButtonStyle, ...(verifying || !otpInput.trim() ? disabledStyle : null) }} disabled={verifying || !otpInput.trim()} onClick={() => void verifyOtp()}>
          {verifying ? "验证中…" : "验证并继续"}
        </button>

        {poster ? (
          <div style={posterWrapStyle}>
            <CachedImage src={poster} alt="poster" style={posterImageStyle} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function get_phone_on_localhost(expectedPhone?: string, options?: { poster?: string | null }): Promise<string> {
  return new Promise((resolve) => {
    const saved = getSavedVerifiedPhone(expectedPhone);
    if (saved) {
      resolve(saved);
      return;
    }

    openOverlay((close) => (
      <PhoneVerificationModal
        initialPhone={expectedPhone}
        poster={options?.poster}
        onResolve={(phone) => {
          close();
          resolve(phone);
        }}
      />
    ));
  });
}

export { clearVerifiedPhone, getSavedVerifiedPhone, normalizePhoneMY, saveVerifiedPhone, formatPhoneForInput };

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  background: "rgba(15, 23, 42, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
  overflowY: "auto",
};

const panelStyle: CSSProperties = {
  width: "min(420px, 100%)",
  maxHeight: "92vh",
  overflowY: "auto",
  boxSizing: "border-box",
  background: "var(--x-color-panel, #ffffff)",
  borderRadius: "var(--x-radius-lg, 18px)",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)",
  padding: "22px 20px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  fontFamily: "var(--x-font-sans, inherit)",
  color: "var(--x-color-ink, #1d2433)",
};

const headStyle: CSSProperties = { textAlign: "center", marginBottom: "2px" };

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  letterSpacing: "1px",
  fontWeight: 700,
  color: "var(--x-color-accent, #0f766e)",
};

const titleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "20px",
  fontWeight: 800,
  color: "var(--x-color-ink, #1d2433)",
};

const subtitleStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted, #5d6678)",
};

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "6px" };

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--x-color-ink, #1d2433)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line, #d8dfeb)",
  background: "var(--x-color-panel, #ffffff)",
  color: "var(--x-color-ink, #1d2433)",
  boxSizing: "border-box",
  outline: "none",
};

const primaryButtonStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line, #d8dfeb)",
  background: "var(--x-color-panel-alt, #f4f7fb)",
  color: "var(--x-color-ink, #1d2433)",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  width: "100%",
  padding: "11px",
  fontSize: "14px",
  borderRadius: "10px",
  border: "1px dashed var(--x-color-line, #d8dfeb)",
  background: "transparent",
  color: "var(--x-color-ink-muted, #5d6678)",
  fontWeight: 600,
  cursor: "pointer",
};

const accentButtonStyle: CSSProperties = {
  width: "100%",
  padding: "13px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "none",
  background: "var(--x-color-accent, #0f766e)",
  color: "#ffffff",
  fontWeight: 800,
  cursor: "pointer",
};

const disabledStyle: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };

const posterWrapStyle: CSSProperties = { marginTop: "6px", textAlign: "center" };

const posterImageStyle: CSSProperties = {
  width: "100%",
  maxWidth: "380px",
  borderRadius: "12px",
};
