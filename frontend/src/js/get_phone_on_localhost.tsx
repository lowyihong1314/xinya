import { useState } from "react";

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
}: {
  onResolve: (phone: string) => void;
  initialPhone?: string;
}) {
  const [phoneInput, setPhoneInput] = useState(() => formatPhoneForInput(initialPhone || ""));
  const [otpInput, setOtpInput] = useState("");
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

      setCallVisible(channel === "sms");
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
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={titleStyle}>手机号验证</div>

          <input
            type="tel"
            placeholder="手机号码"
            value={phoneInput}
            onChange={(event) => setPhoneInput(correctPhoneInputMY(event.target.value))}
            onBlur={() => setPhoneInput((current) => formatPhoneForInput(current))}
            style={inputStyle}
          />

          <input
            type="tel"
            placeholder="验证码（测试可直接输入 991031）"
            value={otpInput}
            onChange={(event) => setOtpInput(event.target.value.replace(/\s+/g, ""))}
            style={inputStyle}
          />

          <button type="button" style={buttonPrimaryStyle} disabled={sending} onClick={() => void sendOtp("sms")}>
            {sending ? "发送中…" : "发送短信验证码"}
          </button>

          {callVisible ? (
            <button type="button" style={buttonSecondaryStyle} disabled={sending} onClick={() => void sendOtp("call")}>
              收不到短信？电话验证
            </button>
          ) : null}

          <button type="button" style={buttonAccentStyle} disabled={verifying} onClick={() => void verifyOtp()}>
            {verifying ? "验证中…" : "验证并继续"}
          </button>

          <div style={posterWrapStyle}>
            <CachedImage src="/static/poster/lamp.png" alt="poster" style={posterImageStyle} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function get_phone_on_localhost(expectedPhone?: string): Promise<string> {
  return new Promise((resolve) => {
    const saved = getSavedVerifiedPhone(expectedPhone);
    if (saved) {
      resolve(saved);
      return;
    }

    openOverlay((close) => (
      <PhoneVerificationModal
        initialPhone={expectedPhone}
        onResolve={(phone) => {
          close();
          resolve(phone);
        }}
      />
    ));
  });
}

export { clearVerifiedPhone, getSavedVerifiedPhone, normalizePhoneMY, saveVerifiedPhone, formatPhoneForInput };

const overlayStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 10000,
  background: "linear-gradient(180deg, rgba(247,243,234,0.96), rgba(239,230,212,0.98))",
};

const pageStyle = {
  minHeight: "100vh",
  padding: "18px",
  boxSizing: "border-box" as const,
};

const cardStyle = {
  maxWidth: "560px",
  margin: "0 auto",
  background: "#fffaf2",
  borderRadius: "18px",
  padding: "18px",
  boxShadow: "0 18px 40px rgba(0,0,0,.15)",
  fontFamily: '"PingFang SC","Microsoft YaHei",serif',
};

const titleStyle = {
  fontSize: "18px",
  fontWeight: 900,
  marginBottom: "14px",
  textAlign: "center" as const,
};

const inputStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #cbb37a",
  marginBottom: "10px",
  boxSizing: "border-box" as const,
};

const buttonPrimaryStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "10px",
  border: "none",
  background: "#cbb37a",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  marginBottom: "10px",
};

const buttonSecondaryStyle = {
  width: "100%",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid #cbb37a",
  background: "#fff",
  color: "#6b5a3c",
  fontWeight: 700,
  cursor: "pointer",
  marginBottom: "10px",
};

const buttonAccentStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "10px",
  border: "none",
  background: "#8b6f3d",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const posterWrapStyle = {
  marginTop: "16px",
  textAlign: "center" as const,
};

const posterImageStyle = {
  width: "100%",
  maxWidth: "420px",
  borderRadius: "12px",
  opacity: "0.95",
};
