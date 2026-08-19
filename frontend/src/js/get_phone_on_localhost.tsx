import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ClipboardEvent, KeyboardEvent } from "react";

import { openOverlay } from "../app/OverlayProvider";
import { CachedImage } from "../components/CachedMedia";
import { apiFetch } from "./apiFetch";
import { clearVerifiedPhone, correctPhoneInputMY, formatPhoneForInput, getSavedVerifiedPhone, normalizePhoneMY, saveVerifiedPhone } from "./phone";
import { show_alert } from "./show_alert";

// Twilio Verify 服务配置的验证码长度（4 位）
const OTP_LENGTH = 4;

// 重发倒计时秒数：号码侧限流是每小时 10 次，别让用户几下点完
const RESEND_SECONDS = 60;

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError((data as { message?: string }).message || "请求失败", response.status);
  }
  return data as { status?: string; message?: string };
}

type Notice = { tone: "error" | "warn" | "success"; text: string } | null;

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
  // 弹窗内的提示条：限流（429）之类的信息 toast 一闪而过看不清，改成留在窗里
  const [notice, setNotice] = useState<Notice>(null);
  const [cooldown, setCooldown] = useState(0);
  const otpBoxRefs = useRef<Array<HTMLInputElement | null>>([]);
  // 同一个码不重复自动提交（避免填满 → 失败 → 又自动提交，白吃限流次数）
  const autoSubmittedRef = useRef("");

  // 重发倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((current) => (current <= 1 ? 0 : current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function focusOtpBox(index: number) {
    otpBoxRefs.current[Math.max(0, Math.min(OTP_LENGTH - 1, index))]?.focus();
  }

  function applyOtp(next: string, caret: number) {
    const cleaned = next.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setOtpInput(cleaned);
    setNotice((current) => (current?.tone === "error" ? null : current));
    focusOtpBox(caret);
    if (cleaned.length === OTP_LENGTH && autoSubmittedRef.current !== cleaned) {
      autoSubmittedRef.current = cleaned;
      void verifyOtp(cleaned);
    }
  }

  function handleOtpBoxChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      // 清掉这一格
      const chars = otpInput.padEnd(OTP_LENGTH, " ").split("");
      chars[index] = " ";
      applyOtp(chars.join("").replace(/ /g, ""), index);
      return;
    }
    if (digits.length > 1) {
      // 粘贴：从当前格开始铺开
      const merged = (otpInput.slice(0, index) + digits).slice(0, OTP_LENGTH);
      applyOtp(merged, merged.length);
      return;
    }
    const chars = otpInput.padEnd(OTP_LENGTH, " ").split("");
    chars[index] = digits;
    applyOtp(chars.join("").trimEnd(), index + 1);
  }

  function handleOtpKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !otpInput[index]) {
      event.preventDefault();
      applyOtp(otpInput.slice(0, Math.max(0, index - 1)), index - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusOtpBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusOtpBox(index + 1);
    }
  }

  function handleOtpPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    applyOtp(pasted.slice(0, OTP_LENGTH), Math.min(pasted.length, OTP_LENGTH - 1));
  }

  function resetOtp() {
    setOtpInput("");
    autoSubmittedRef.current = "";
    focusOtpBox(0);
  }

  async function sendOtp(channel: "sms" | "call" = "sms") {
    const phone = normalizePhoneMY(phoneInput);
    if (!phone) {
      setNotice({ tone: "error", text: "请输入正确的马来西亚手机号码" });
      return;
    }

    const formData = new FormData();
    formData.append("phone", phone);
    formData.append("channel", channel);

    setSending(true);
    setNotice(null);
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
      setCooldown(RESEND_SECONDS);
      resetOtp();
      setNotice({
        tone: "success",
        text: channel === "call" ? "语音电话拨打中，请留意来电" : `验证码已发送到 ${formatPhoneForInput(phone)}，请查收短信`,
      });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setNotice({
        tone: status === 429 ? "warn" : "error",
        text: error instanceof Error ? error.message : "发送失败",
      });
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp(codeOverride?: string) {
    const phone = normalizePhoneMY(phoneInput);
    const otp = (codeOverride ?? otpInput).trim();
    if (!phone) {
      setNotice({ tone: "error", text: "请输入正确的马来西亚手机号码" });
      return;
    }
    if (otp.length < OTP_LENGTH) {
      setNotice({ tone: "error", text: `请输入 ${OTP_LENGTH} 位验证码` });
      return;
    }

    setVerifying(true);
    setNotice(null);
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
      // 短路码验证失败时顺手清掉本地已验证手机号（应急重置用）
      if (otp === "1031") {
        clearVerifiedPhone();
      }
      const status = error instanceof ApiError ? error.status : 0;
      setNotice({
        tone: status === 429 ? "warn" : "error",
        text: error instanceof Error ? error.message : "验证失败",
      });
      resetOtp();
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
          <label style={labelStyle} htmlFor="phone-verify-otp-0">
            短信验证码（{OTP_LENGTH} 位数字）
          </label>
          <div style={otpBoxRowStyle}>
            {Array.from({ length: OTP_LENGTH }).map((_, index) => (
              <input
                key={index}
                id={`phone-verify-otp-${index}`}
                ref={(node) => {
                  otpBoxRefs.current[index] = node;
                }}
                type="tel"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={OTP_LENGTH}
                value={otpInput[index] || ""}
                disabled={verifying}
                aria-label={`验证码第 ${index + 1} 位`}
                onChange={(event) => handleOtpBoxChange(index, event.target.value)}
                onKeyDown={(event) => handleOtpKeyDown(index, event)}
                onPaste={handleOtpPaste}
                onFocus={(event) => event.target.select()}
                style={{
                  ...otpBoxStyle,
                  ...(otpInput[index] ? otpBoxFilledStyle : null),
                  ...(verifying ? disabledStyle : null),
                }}
              />
            ))}
          </div>
          <span style={otpHintStyle}>
            {verifying ? "验证中…" : "填满 4 位会自动验证，也可以直接粘贴短信里的验证码"}
          </span>
        </div>

        {notice ? (
          <div style={{ ...noticeStyle, ...noticeToneStyle(notice.tone) }} role="status">
            <i
              className={
                notice.tone === "success"
                  ? "fa-solid fa-circle-check"
                  : notice.tone === "warn"
                    ? "fa-solid fa-hourglass-half"
                    : "fa-solid fa-circle-exclamation"
              }
              aria-hidden="true"
            />
            <span>{notice.text}</span>
          </div>
        ) : null}

        <button
          type="button"
          style={{ ...primaryButtonStyle, ...(sending || cooldown > 0 ? disabledStyle : null) }}
          disabled={sending || cooldown > 0}
          onClick={() => void sendOtp("sms")}
        >
          {sending
            ? "发送中…"
            : cooldown > 0
              ? `重新发送（${cooldown}s）`
              : otpSent
                ? "重新发送验证码"
                : "发送短信验证码"}
        </button>

        {callVisible ? (
          <button
            type="button"
            style={{ ...ghostButtonStyle, ...(sending || cooldown > 0 ? disabledStyle : null) }}
            disabled={sending || cooldown > 0}
            onClick={() => void sendOtp("call")}
          >
            {cooldown > 0 ? `收不到短信？${cooldown}s 后可改用语音电话` : "收不到短信？改用语音电话验证"}
          </button>
        ) : null}

        <button
          type="button"
          style={{ ...accentButtonStyle, ...(verifying || otpInput.length < OTP_LENGTH ? disabledStyle : null) }}
          disabled={verifying || otpInput.length < OTP_LENGTH}
          onClick={() => void verifyOtp()}
        >
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

const otpBoxRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  justifyContent: "center",
};

const otpBoxStyle: CSSProperties = {
  width: "56px",
  height: "60px",
  textAlign: "center",
  fontSize: "24px",
  fontWeight: 800,
  borderRadius: "12px",
  border: "1px solid var(--x-color-line, #d8dfeb)",
  background: "var(--x-color-panel-alt, #f4f7fb)",
  color: "var(--x-color-ink, #1d2433)",
  boxSizing: "border-box",
  outline: "none",
};

const otpBoxFilledStyle: CSSProperties = {
  borderColor: "var(--x-color-accent, #0f766e)",
  background: "var(--x-color-panel, #ffffff)",
};

const otpHintStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted, #5d6678)",
  textAlign: "center",
};

const noticeStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "8px",
  padding: "10px 12px",
  borderRadius: "10px",
  fontSize: "13px",
  lineHeight: 1.5,
  fontWeight: 600,
  border: "1px solid transparent",
};

function noticeToneStyle(tone: "error" | "warn" | "success"): CSSProperties {
  if (tone === "success") {
    return {
      background: "var(--x-color-success-soft, #e7f6ec)",
      borderColor: "rgba(21,128,61,0.28)",
      color: "var(--x-color-success, #15803d)",
    };
  }
  if (tone === "warn") {
    // 限流（429）：橙色，提示是「太频繁」而不是「填错了」
    return {
      background: "var(--x-color-warning-soft, #fdf3e3)",
      borderColor: "var(--x-color-warning-border, rgba(180,120,20,0.32))",
      color: "var(--x-color-warning, #b47814)",
    };
  }
  return {
    background: "var(--x-color-danger-soft, #fdecec)",
    borderColor: "var(--x-color-danger-border, rgba(190,60,60,0.3))",
    color: "var(--x-color-danger, #be3c3c)",
  };
}

const disabledStyle: CSSProperties = { opacity: 0.55, cursor: "not-allowed" };

const posterWrapStyle: CSSProperties = { marginTop: "6px", textAlign: "center" };

const posterImageStyle: CSSProperties = {
  width: "100%",
  maxWidth: "380px",
  borderRadius: "12px",
};
