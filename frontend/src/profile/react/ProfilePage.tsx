import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent } from "react";

import { useUserState } from "../../app/UserState";
import { showCCTVModal } from "../../CRM/CCTV/showCCTVModal";
import { ensureDesignTokens } from "../../theme/designTokens";
import { updateProfile, uploadProfileImage } from "./api";
import type { ProfileFormValues, ProfileUser } from "./types";

const FIELD_CONFIG: Array<{
  key: keyof ProfileFormValues;
  label: string;
  type?: "text" | "email" | "tel" | "textarea" | "select";
  options?: Array<{ label: string; value: string }>;
}> = [
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "name_NRIC", label: "姓名", type: "text" },
  { key: "NRIC", label: "NRIC", type: "text" },
  {
    key: "gender",
    label: "性别",
    type: "select",
    options: [
      { label: "未指定", value: "" },
      { label: "男", value: "男" },
      { label: "女", value: "女" },
    ],
  },
  { key: "parent_1", label: "家长 1", type: "text" },
  { key: "parent_1_phone", label: "家长 1 电话", type: "tel" },
  { key: "medical", label: "病史", type: "textarea" },
  { key: "allergy", label: "过敏", type: "textarea" },
];

function emptyFormValues(): ProfileFormValues {
  return {
    email: "",
    phone: "",
    name_NRIC: "",
    NRIC: "",
    gender: "",
    parent_1: "",
    parent_1_phone: "",
    medical: "",
    allergy: "",
  };
}

function formValuesFromUser(user: ProfileUser | null): ProfileFormValues {
  return {
    email: String(user?.email || ""),
    phone: String(user?.phone || ""),
    name_NRIC: String(user?.name_NRIC || ""),
    NRIC: String(user?.NRIC || ""),
    gender: String(user?.gender || ""),
    parent_1: String(user?.parent_1 || ""),
    parent_1_phone: String(user?.parent_1_phone || ""),
    medical: String(user?.medical || ""),
    allergy: String(user?.allergy || ""),
  };
}

export function ProfilePage() {
  ensureDesignTokens();

  const { user, isAuthenticated, loadingUser, refreshUser, logout, openLogin, isMobile } = useUserState();
  const profileUser = (user as ProfileUser | null) ?? null;

  const [formValues, setFormValues] = useState<ProfileFormValues>(emptyFormValues);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFormValues(formValuesFromUser(profileUser));
  }, [profileUser]);

  useEffect(() => {
    if (!message && !error) {
      return;
    }
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  const avatarSrc = useMemo(() => {
    if (!profileUser?.username) {
      return "/static/images/logo/logo.png";
    }
    return `/api/user_control/get_profile_image/${profileUser.username}?t=${avatarVersion}`;
  }, [avatarVersion, profileUser?.username]);

  if (loadingUser) {
    return (
      <div style={pageShellStyle}>
        <div style={stateCardStyle(isMobile)}>Loading profile…</div>
      </div>
    );
  }

  if (!isAuthenticated || !profileUser?.username) {
    return (
      <div style={pageShellStyle}>
        <div style={gateCardStyle(isMobile)}>
          <div style={eyebrowStyle}>Profile Access</div>
          <h1 style={gateTitleStyle}>请先登录</h1>
          <p style={gateBodyStyle}>用户资料页已经切到 React 架构，登录态统一来自全局 user state。</p>
          <div style={gateActionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={openLogin}>
              打开登录框
            </button>
            <button
              type="button"
              style={ghostButtonStyle}
              onClick={() => window.__xinyaNavigate?.("home")}
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateProfile(profileUser.id, formValues);
      await refreshUser();
      setMessage("资料已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadProfileImage(file);
      await refreshUser();
      setAvatarVersion(Date.now());
      setMessage("头像已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleLogout() {
    setError(null);
    try {
      await logout();
      window.__xinyaNavigate?.("home", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "退出失败");
    }
  }

  function updateField<Key extends keyof ProfileFormValues>(key: Key, value: ProfileFormValues[Key]) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div style={pageShellStyle}>
      <section style={heroCardStyle(isMobile)}>
        <div style={heroCopyStyle}>
          <div style={eyebrowStyle}>Profile Center</div>
          <h1 style={heroTitleStyle(isMobile)}>{profileUser.username}</h1>
          <div style={heroMetaRowStyle(isMobile)}>
            <div style={heroMetaCardStyle(isMobile)}>
              <div style={heroMetaLabelStyle}>Status</div>
              <div style={heroMetaValueStyle}>Authenticated</div>
            </div>
            <div style={heroMetaCardStyle(isMobile)}>
              <div style={heroMetaLabelStyle}>Email</div>
              <div style={heroMetaValueStyle}>{profileUser.email || "未填写"}</div>
            </div>
          </div>
        </div>
        <div style={avatarPanelStyle(isMobile)}>
          <div style={avatarWrapStyle(isMobile)}>
            <img src={avatarSrc} alt={profileUser.username} style={avatarStyle(isMobile)} />
            <label style={avatarUploadLabelStyle(isMobile)}>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                style={{ display: "none" }}
              />
              {uploading ? "Uploading…" : "更新头像"}
            </label>
          </div>
        </div>
      </section>

      {message ? <div style={successBannerStyle}>{message}</div> : null}
      {error ? <div style={errorBannerStyle}>{error}</div> : null}

      <section style={contentGridStyle(isMobile)}>
        <article style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelEyebrowStyle}>Personal Data</div>
              <h2 style={panelTitleStyle}>基本资料</h2>
            </div>
          </div>
          <form style={formGridStyle(isMobile)} onSubmit={handleSubmit}>
            {FIELD_CONFIG.map((field) => (
              <label
                key={field.key}
                style={field.type === "textarea" ? wideFieldStyle : fieldStyle}
              >
                <span style={fieldLabelStyle}>{field.label}</span>
                <FieldControl
                  field={field}
                  value={formValues[field.key]}
                  onChange={(value) => updateField(field.key, value)}
                />
              </label>
            ))}
            <div style={formActionsStyle(isMobile)}>
              <button type="button" style={ghostButtonStyle} onClick={() => setFormValues(formValuesFromUser(profileUser))}>
                重置
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={saving}>
                {saving ? "保存中…" : "保存资料"}
              </button>
            </div>
          </form>
        </article>

        <aside style={sideColumnStyle}>
          <article style={sidePanelStyle}>
            <div style={panelEyebrowStyle}>Quick Actions</div>
            <h2 style={panelTitleStyle}>快捷操作</h2>
            <div style={actionListStyle}>
              <button type="button" style={secondaryActionStyle} onClick={() => showCCTVModal()}>
                查看 CCTV
              </button>
              <button type="button" style={secondaryActionStyle} onClick={() => void refreshUser()}>
                刷新用户状态
              </button>
              <button type="button" style={dangerButtonStyle} onClick={() => void handleLogout()}>
                退出登录
              </button>
            </div>
          </article>

          <article style={sidePanelStyle}>
            <div style={panelEyebrowStyle}>Session</div>
            <h2 style={panelTitleStyle}>当前状态</h2>
            <div style={statListStyle}>
              <div style={statRowStyle(isMobile)}>
                <span style={statLabelStyle}>Username</span>
                <span style={statValueStyle}>{profileUser.username}</span>
              </div>
              <div style={statRowStyle(isMobile)}>
                <span style={statLabelStyle}>Phone</span>
                <span style={statValueStyle}>{profileUser.phone || "未填写"}</span>
              </div>
              <div style={statRowStyle(isMobile)}>
                <span style={statLabelStyle}>Guardian</span>
                <span style={statValueStyle}>{profileUser.parent_1 || "未填写"}</span>
              </div>
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: (typeof FIELD_CONFIG)[number];
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === "textarea") {
    return (
      <textarea
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={textareaStyle}
      />
    );
  }

  if (field.type === "select") {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle}>
        {field.options?.map((option) => (
          <option key={option.value || "blank"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.type || "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={inputStyle}
    />
  );
}

const pageShellStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  padding: "32px clamp(18px, 4vw, 40px) 48px",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.2), transparent 34%), linear-gradient(180deg, var(--x-color-canvas), #e8eef5)",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
};

function heroCardStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.8fr) minmax(260px, 0.9fr)",
    gap: isMobile ? "18px" : "24px",
    padding: isMobile ? "18px 16px 20px" : "28px",
    borderRadius: "var(--x-radius-lg)",
    background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
    color: "white",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    alignItems: isMobile ? "start" : "center",
  };
}

const heroCopyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

function avatarPanelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    placeItems: isMobile ? "start center" : "center",
    order: isMobile ? -1 : 0,
  };
}

function avatarWrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "12px" : "16px",
    justifyItems: "center",
    width: isMobile ? "100%" : undefined,
  };
}

function avatarStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "124px" : "160px",
    height: isMobile ? "124px" : "160px",
    borderRadius: "50%",
    objectFit: "cover",
    border: "4px solid rgba(255,255,255,0.78)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.24)",
  };
}

function avatarUploadLabelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: isMobile ? "100%" : "132px",
    width: isMobile ? "100%" : undefined,
    padding: "12px 16px",
    borderRadius: "999px",
    cursor: "pointer",
    background: "rgba(255,255,255,0.16)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.28)",
    backdropFilter: "blur(10px)",
    boxSizing: "border-box",
  };
}

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.74,
};

function heroTitleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "clamp(28px, 10vw, 40px)" : "clamp(36px, 5vw, 56px)",
    lineHeight: 1,
  };
}

const heroBodyStyle: CSSProperties = {
  margin: 0,
  maxWidth: "62ch",
  lineHeight: 1.7,
  opacity: 0.86,
};

function heroMetaRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))",
    gap: isMobile ? "10px" : "14px",
    marginTop: "8px",
  };
}

function heroMetaCardStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "14px 16px" : "16px 18px",
    borderRadius: "var(--x-radius-md)",
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.18)",
  };
}

const heroMetaLabelStyle: CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  opacity: 0.7,
};

const heroMetaValueStyle: CSSProperties = {
  marginTop: "8px",
  fontSize: "18px",
  fontWeight: 700,
};

function contentGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.6fr) minmax(280px, 0.9fr)",
    gap: "24px",
    marginTop: "24px",
  };
}

const panelStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel)",
  boxShadow: "0 24px 50px rgba(15,23,42,0.08)",
  border: "1px solid rgba(216,223,235,0.8)",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  marginBottom: "20px",
};

const panelEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const panelTitleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "28px",
  lineHeight: 1.1,
  color: "var(--x-color-ink)",
};

function formGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "16px",
  };
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const wideFieldStyle: CSSProperties = {
  ...fieldStyle,
  gridColumn: "1 / -1",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  padding: "12px 14px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
  fontSize: "14px",
  boxSizing: "border-box",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "110px",
  resize: "vertical",
};

function formActionsStyle(isMobile: boolean): CSSProperties {
  return {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: isMobile ? "stretch" : "flex-end",
    gap: "12px",
    marginTop: "4px",
    flexWrap: "wrap",
  };
}

const sideColumnStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
  alignSelf: "start",
};

const sidePanelStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(246,248,252,0.98))",
  border: "1px solid rgba(216,223,235,0.9)",
  boxShadow: "0 18px 40px rgba(15,23,42,0.07)",
};

const actionListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  marginTop: "18px",
};

const statListStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  marginTop: "18px",
};

function statRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: isMobile ? "flex-start" : "center",
    flexDirection: isMobile ? "column" : "row",
  };
}

const statLabelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "14px",
};

const statValueStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--x-color-ink)",
  textAlign: "right",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "white",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryActionStyle: CSSProperties = {
  ...ghostButtonStyle,
  width: "100%",
  justifyContent: "center",
};

const dangerButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid rgba(194,65,12,0.22)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

const successBannerStyle: CSSProperties = {
  marginTop: "18px",
  padding: "14px 18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};

const errorBannerStyle: CSSProperties = {
  marginTop: "18px",
  padding: "14px 18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

function stateCardStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "720px",
    margin: "48px auto",
    padding: isMobile ? "20px" : "24px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel)",
    boxShadow: "0 24px 60px rgba(15,23,42,0.08)",
    textAlign: "center",
  };
}

function gateCardStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "720px",
    margin: "48px auto",
    padding: isMobile ? "24px" : "32px",
    borderRadius: "var(--x-radius-lg)",
    background: "linear-gradient(160deg, var(--x-color-panel), var(--x-color-panel-alt))",
    boxShadow: "0 24px 60px rgba(15,23,42,0.1)",
  };
}

const gateTitleStyle: CSSProperties = {
  margin: "10px 0 12px",
  fontSize: "40px",
  color: "var(--x-color-ink)",
};

const gateBodyStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const gateActionsStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  marginTop: "20px",
  flexWrap: "wrap",
};
