import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { API_BASE, IS_APK } from "../../js/apiBase";
import { downloadUrl } from "../../js/browserActions";
import {
  clearAllNativeMediaCache,
  getNativeMediaCacheStats,
  mediaCacheBytesToGb,
  NATIVE_MEDIA_CACHE_DEFAULT_GB,
  NATIVE_MEDIA_CACHE_MAX_GB,
  NATIVE_MEDIA_CACHE_MIN_GB,
  setNativeMediaCacheMaxGb,
  trimNativeMediaCache,
  type NativeMediaCacheStats,
} from "../../js/nativeMediaCache";
import {
  clearAllNativeResponseCache,
  getNativeResponseCacheStats,
  trimNativeResponseCache,
  type NativeResponseCacheStats,
} from "../../js/nativeResponseCache";
import { isMobileNativeRuntime } from "../../mobile/native/capacitor";
import { changeMyPassword, fetchAppReleases, fetchMyFootprints, requestEmailChange, startMembershipRenewal, updateProfile, uploadProfileImage } from "./api";
import { MembershipActionCard } from "./MembershipActionCard";
import { EmailPanel } from "./EmailPanel";
import type {
  AppRelease,
  ProfileFootprintPayload,
  ProfileFootprintSummary,
  ProfileFormFootprint,
  ProfileFormValues,
  ProfileUser,
  ProfileYouthFootprint,
} from "./types";

type ProfileSectionKey = "profile" | "membership" | "email" | "journey" | "app";
type PasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type NativeCacheDebugStats = {
  media: NativeMediaCacheStats;
  response: NativeResponseCacheStats;
};

const DEFAULT_SECTION: ProfileSectionKey = "profile";

const SECTION_ITEMS: Array<{ key: ProfileSectionKey; label: string; hint: string }> = [
  { key: "profile", label: "资料", hint: "个人 · 账号 · 转账" },
  { key: "membership", label: "会员", hint: "Membership" },
  { key: "email", label: "邮件", hint: "Email" },
  { key: "journey", label: "足迹", hint: "My journey" },
  { key: "app", label: "下载 App", hint: "Download" },
];

const BANK_NOTE_FIELDS: Array<{
  key: keyof ProfileFormValues;
  label: string;
  type?: "text" | "email" | "tel" | "textarea" | "select";
  description: string;
}> = [
  {
    key: "bank_name",
    label: "银行名称",
    type: "text",
    description: "填写你常用收款银行的名称，方便后续核对与转账。",
  },
  {
    key: "account_name",
    label: "账户名称",
    type: "text",
    description: "填写银行账户持有人姓名，建议与银行资料一致。",
  },
  {
    key: "bank_account",
    label: "银行账号",
    type: "text",
    description: "填写你个人收款银行账号，可用于后续转账或人工核对。",
  },
  {
    key: "tng_number",
    label: "TNG 号码",
    type: "tel",
    description: "填写你的 Touch 'n Go 绑定号码，方便个人电子钱包转账。",
  },
];

function isProfileSectionKey(value: string | undefined): value is ProfileSectionKey {
  return SECTION_ITEMS.some((item) => item.key === value);
}

function profileSectionPath(section: ProfileSectionKey) {
  return `/profile/${section}`;
}

const FIELD_GROUPS: Array<{
  title: string;
  description: string;
  fields: Array<{
    key: keyof ProfileFormValues;
    label: string;
    type?: "text" | "email" | "tel" | "textarea" | "select";
    options?: Array<{ label: string; value: string }>;
    readOnly?: boolean;
  }>;
}> = [
  {
    title: "身份资料",
    description: "这部分会影响成员绑定与报名足迹整理。",
    fields: [
      { key: "username", label: "Username", type: "text" },
      { key: "display_name", label: "显示名称", type: "text" },
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
      {
        key: "display",
        label: "对外显示",
        type: "select",
        options: [
          { label: "未设置", value: "" },
          { label: "公开显示", value: "true" },
          { label: "不公开显示", value: "false" },
        ],
      },
    ],
  },
  {
    title: "联络方式",
    description: "用于活动联系与紧急联络。",
    fields: [
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "parent_1", label: "家长 1", type: "text" },
      { key: "parent_1_phone", label: "家长 1 电话", type: "tel" },
    ],
  },
  {
    title: "健康备注",
    description: "病史与过敏会帮助活动筹备时更安全地照顾你。",
    fields: [
      { key: "medical", label: "病史", type: "textarea" },
      { key: "allergy", label: "过敏", type: "textarea" },
    ],
  },
];

function emptyFormValues(): ProfileFormValues {
  return {
    username: "",
    display_name: "",
    display: "",
    email: "",
    phone: "",
    NRIC: "",
    gender: "",
    parent_1: "",
    parent_1_phone: "",
    medical: "",
    allergy: "",
    bank_name: "",
    account_name: "",
    bank_account: "",
    tng_number: "",
  };
}

function formValuesFromUser(user: ProfileUser | null): ProfileFormValues {
  return {
    username: String(user?.username || ""),
    display_name: String(user?.display_name || ""),
    display: user?.display == null ? "" : user.display ? "true" : "false",
    email: String(user?.email || ""),
    phone: String(user?.phone || ""),
    NRIC: String(user?.NRIC || ""),
    gender: String(user?.gender || ""),
    parent_1: String(user?.parent_1 || ""),
    parent_1_phone: String(user?.parent_1_phone || ""),
    medical: String(user?.medical || ""),
    allergy: String(user?.allergy || ""),
    bank_name: String(user?.bank_name || ""),
    account_name: String(user?.account_name || ""),
    bank_account: String(user?.bank_account || ""),
    tng_number: String(user?.tng_number || ""),
  };
}

function emptyFootprintSummary(): ProfileFootprintSummary {
  return {
    registration_form_count: 0,
    event_count: 0,
    youth_class_count: 0,
    payment_count: 0,
    total_count: 0,
  };
}

function emptyFootprintPayload(): ProfileFootprintPayload {
  return {
    member: null,
    summary: emptyFootprintSummary(),
    registrations: [],
    youth_class_registrations: [],
  };
}

function emptyPasswordFormValues(): PasswordFormValues {
  return {
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  };
}

function emptyNativeCacheStats() {
  return {
    entryCount: 0,
    totalBytes: 0,
    maxBytes: 0,
    trimmedEntries: 0,
    trimmedBytes: 0,
  };
}

function emptyNativeCacheDebugStats(): NativeCacheDebugStats {
  return {
    media: emptyNativeCacheStats(),
    response: emptyNativeCacheStats(),
  };
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const digits = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "未记录";
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

function getMalaysiaToday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(partMap.year || "0"),
    month: Number(partMap.month || "0"),
    day: Number(partMap.day || "0"),
  };
}

function calcAgeFromNric(nric: string | null | undefined) {
  const digits = String(nric || "").replace(/\D/g, "");
  if (digits.length < 6) {
    return null;
  }

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return null;
  }

  const today = getMalaysiaToday();
  const currentYY = today.year % 100;
  const year = yy > currentYY ? 1900 + yy : 2000 + yy;
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (
    Number.isNaN(dob.getTime()) ||
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== mm - 1 ||
    dob.getUTCDate() !== dd
  ) {
    return null;
  }

  // 全局年龄规则：只按出生年份计算（当前年份 - 出生年份），不看月份/生日。
  // 与后端 app/form/services.py:_calc_age_from_nric 保持一致。
  const age = today.year - year;
  return age >= 0 && age <= 120 ? age : null;
}

function contactLabelsForAge(age: number | null) {
  if (age != null && age > 18) {
    return {
      name: "紧急联络人",
      phone: "紧急联络人电话",
      summary: "紧急联络人",
    };
  }
  return {
    name: "家长 1",
    phone: "家长 1 电话",
    summary: "家长",
  };
}

function paymentStatusLabel(status: string | null | undefined) {
  if (status === "checked") return "已确认付款";
  if (status === "fail") return "付款被退回";
  if (status === "process") return "付款审核中";
  return "未提交付款";
}

function youthStatusLabel(status: string | null | undefined) {
  if (status === "paid") return "已付款";
  if (status === "reject") return "已退回";
  return "处理中";
}

function pickLatestFootprint(
  registrations: ProfileFormFootprint[],
  youthItems: ProfileYouthFootprint[],
): { title: string; meta: string; kind: string } | null {
  const candidates = [
    ...registrations.map((item) => ({
      key: item.footprint_at || item.created_at || "",
      title: item.events?.[0]?.event_name || item.title || "活动报名",
      meta: `最近记录 ${formatDateTime(item.footprint_at || item.created_at)}`,
      kind: "活动报名",
    })),
    ...youthItems.map((item) => ({
      key: item.footprint_at || item.submitted_at || "",
      title: item.chinese_name || item.english_name || "青少年报名",
      meta: `提交时间 ${formatDateTime(item.footprint_at || item.submitted_at)}`,
      kind: "课程报名",
    })),
  ].filter((item) => item.key);

  candidates.sort((a, b) => b.key.localeCompare(a.key));
  if (!candidates.length) {
    return null;
  }
  return {
    title: candidates[0].title,
    meta: candidates[0].meta,
    kind: candidates[0].kind,
  };
}

export function ProfilePage() {
  useEnsureDesignTokens();

  const { section: sectionParam } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, loadingUser, refreshUser, logout, openLogin, isMobile } = useUserState();
  const profileUser = (user as ProfileUser | null) ?? null;
  const activeSection = isProfileSectionKey(sectionParam) ? sectionParam : DEFAULT_SECTION;

  const [formValues, setFormValues] = useState<ProfileFormValues>(emptyFormValues);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [passwordValues, setPasswordValues] = useState<PasswordFormValues>(emptyPasswordFormValues);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editingKeys, setEditingKeys] = useState<Set<string>>(() => new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [membershipActionBusy, setMembershipActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [footprints, setFootprints] = useState<ProfileFootprintPayload>(emptyFootprintPayload);
  const [footprintsLoading, setFootprintsLoading] = useState(false);
  const [footprintsError, setFootprintsError] = useState<string | null>(null);
  const [appReleases, setAppReleases] = useState<AppRelease[]>([]);
  const [appReleasesLoading, setAppReleasesLoading] = useState(false);
  const [nativeCacheStats, setNativeCacheStats] = useState<NativeCacheDebugStats>(emptyNativeCacheDebugStats);
  const [nativeCacheLoading, setNativeCacheLoading] = useState(false);
  const [mediaCacheLimitGb, setMediaCacheLimitGb] = useState(NATIVE_MEDIA_CACHE_DEFAULT_GB);
  const appReleasesFetched = useRef(false);
  const isNativeMobileRuntime = IS_APK && isMobileNativeRuntime();

  async function loadFootprints() {
    if (!isAuthenticated || !profileUser?.id) {
      setFootprints(emptyFootprintPayload());
      setFootprintsLoading(false);
      setFootprintsError(null);
      return;
    }

    setFootprintsLoading(true);
    setFootprintsError(null);
    try {
      const payload = await fetchMyFootprints();
      setFootprints({
        member: payload.member ?? null,
        summary: payload.summary ?? emptyFootprintSummary(),
        registrations: payload.registrations ?? [],
        youth_class_registrations: payload.youth_class_registrations ?? [],
      });
    } catch (err) {
      setFootprints(emptyFootprintPayload());
      setFootprintsError(err instanceof Error ? err.message : "足迹加载失败");
    } finally {
      setFootprintsLoading(false);
    }
  }

  async function loadNativeCacheStats() {
    if (!isNativeMobileRuntime) {
      setNativeCacheStats(emptyNativeCacheDebugStats());
      setNativeCacheLoading(false);
      return;
    }

    setNativeCacheLoading(true);
    try {
      const [media, response] = await Promise.all([
        getNativeMediaCacheStats(),
        getNativeResponseCacheStats(),
      ]);
      setNativeCacheStats({ media, response });
      setMediaCacheLimitGb(mediaCacheBytesToGb(media.maxBytes));
    } finally {
      setNativeCacheLoading(false);
    }
  }

  useEffect(() => {
    setFormValues(formValuesFromUser(profileUser));
  }, [profileUser]);

  useEffect(() => {
    setPasswordValues(emptyPasswordFormValues());
  }, [profileUser?.id, profileUser?.has_password]);

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

  useEffect(() => {
    if (!isAuthenticated || !profileUser?.id) {
      setFootprints(emptyFootprintPayload());
      setFootprintsLoading(false);
      setFootprintsError(null);
      return;
    }
    void loadFootprints();
  }, [isAuthenticated, profileUser?.id, profileUser?.nric_asset_id, profileUser?.NRIC, profileUser?.name_NRIC]);

  useEffect(() => {
    if (sectionParam && !isProfileSectionKey(sectionParam)) {
      navigate(profileSectionPath(DEFAULT_SECTION), { replace: true });
    }
  }, [navigate, sectionParam]);

  useEffect(() => {
    if (activeSection !== "app" || appReleasesFetched.current) return;
    appReleasesFetched.current = true;
    setAppReleasesLoading(true);
    fetchAppReleases()
      .then(setAppReleases)
      .catch(() => setAppReleases([]))
      .finally(() => setAppReleasesLoading(false));
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "app" || !isNativeMobileRuntime) {
      return;
    }
    void loadNativeCacheStats();
  }, [activeSection, isNativeMobileRuntime]);

  const avatarSrc = useMemo(() => {
    if (!profileUser?.username) {
      return `${API_BASE}/static/images/logo/logo.png`;
    }
    return `${API_BASE}/api/user_control/get_profile_image/${profileUser.username}?t=${avatarVersion}`;
  }, [avatarVersion, profileUser?.username]);

  const footprintSummary = footprints.summary ?? emptyFootprintSummary();
  const registrations = footprints.registrations ?? [];
  const youthItems = footprints.youth_class_registrations ?? [];
  const completenessFields = FIELD_GROUPS.flatMap((group) => group.fields).filter((field) => !field.readOnly);
  const filledFieldCount = completenessFields.filter((field) => String(formValues[field.key] || "").trim()).length;
  const totalFieldCount = completenessFields.length;
  const latestFootprint = pickLatestFootprint(registrations, youthItems);
  const nextMembershipExpiry = profileUser?.member_renewals?.[0]?.renewal_date ?? null;
  const hasBoundNric = Boolean(profileUser?.NRIC);
  const profileAge = useMemo(() => calcAgeFromNric(profileUser?.NRIC), [profileUser?.NRIC]);
  const contactLabels = useMemo(() => contactLabelsForAge(profileAge), [profileAge]);

  if (loadingUser) {
    return (
      <div style={pageShellStyle(isMobile)}>
        <div style={stateCardStyle(isMobile)}>Loading profile…</div>
      </div>
    );
  }

  if (!isAuthenticated || !profileUser?.username) {
    return (
      <div style={pageShellStyle(isMobile)}>
        <div style={gateCardStyle(isMobile)}>
          <div style={eyebrowStyle}>Profile Access</div>
          <h1 style={gateTitleStyle}>请先登录</h1>
          <p style={gateBodyStyle}>用户资料页已经切到 React 架构，登录态统一来自全局 user state。</p>
          <div style={gateActionsStyle}>
            <button type="button" style={primaryButtonStyle} onClick={() => openLogin()}>
              打开登录框
            </button>
            <button
              type="button"
              style={ghostButtonStyle}
              onClick={() => navigate("/")}
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
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
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "退出失败");
    }
  }

  function updateField<Key extends keyof ProfileFormValues>(key: Key, value: ProfileFormValues[Key]) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  function startEditField(key: keyof ProfileFormValues) {
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function stopEditField(key: keyof ProfileFormValues) {
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function cancelEditField(key: keyof ProfileFormValues) {
    setFormValues((prev) => ({ ...prev, [key]: formValuesFromUser(profileUser)[key] }));
    stopEditField(key);
  }

  async function saveField(key: keyof ProfileFormValues) {
    if (!profileUser) {
      return;
    }
    // 邮箱改动要走验证流程，不直接保存。
    if (key === "email") {
      await requestEmailChangeFlow();
      return;
    }
    setSavingKey(key);
    setError(null);
    try {
      await updateProfile(profileUser.id, formValues);
      await refreshUser();
      if (key === "NRIC") {
        await loadFootprints();
      }
      setMessage("资料已更新");
      stopEditField(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingKey(null);
    }
  }

  async function requestEmailChangeFlow() {
    if (!profileUser) {
      return;
    }
    const newEmail = (formValues.email || "").trim();
    setSavingKey("email");
    setError(null);
    setMessage(null);
    try {
      const result = await requestEmailChange(newEmail);
      setMessage(result.message || "验证邮件已发送，请点击其中链接完成验证");
      // 验证前不改真实邮箱：把输入框还原为当前生效邮箱，避免误以为已改。
      setFormValues((prev) => ({ ...prev, email: profileUser.email || "" }));
      stopEditField("email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证邮件发送失败");
    } finally {
      setSavingKey(null);
    }
  }

  function updatePasswordField<Key extends keyof PasswordFormValues>(key: Key, value: PasswordFormValues[Key]) {
    setPasswordValues((prev) => ({ ...prev, [key]: value }));
  }

  function navigateToSection(section: ProfileSectionKey) {
    navigate(profileSectionPath(section));
  }

  async function handleMembershipAction() {
    setError(null);

    if (!profileUser?.is_member) {
      if (!hasBoundNric) {
        navigateToSection("profile");
        setError("请先在资料页填写并保存 NRIC，再继续会员升级申请。");
        return;
      }
      window.open(`${window.location.origin}/template/long-open-registration-form?preferred=membership&source=profile`, "_blank", "noopener,noreferrer");
      return;
    }

    if (!hasBoundNric) {
      navigateToSection("profile");
      setError("当前账号已标记为会员，但还没有绑定 NRIC，请先回资料页补齐。");
      return;
    }

    setMembershipActionBusy(true);
    try {
      const payload = await startMembershipRenewal();
      if (payload.payment_url) {
        window.open(payload.payment_url, "_blank", "noopener,noreferrer");
      }
      setMessage(payload.message || "续费付款链接已打开。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成续费链接失败");
    } finally {
      setMembershipActionBusy(false);
    }
  }

  async function handleRefreshNativeCaches() {
    setError(null);
    try {
      await loadNativeCacheStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取本机缓存失败");
    }
  }

  async function handleTrimNativeCaches() {
    if (!isNativeMobileRuntime) {
      return;
    }

    setNativeCacheLoading(true);
    setError(null);
    try {
      const [media, response] = await Promise.all([
        trimNativeMediaCache(),
        trimNativeResponseCache(),
      ]);
      setNativeCacheStats({ media, response });
      setMessage("本机缓存已裁剪");
    } catch (err) {
      setError(err instanceof Error ? err.message : "裁剪本机缓存失败");
    } finally {
      setNativeCacheLoading(false);
    }
  }

  async function handleClearNativeCaches() {
    if (!isNativeMobileRuntime) {
      return;
    }

    setNativeCacheLoading(true);
    setError(null);
    try {
      await Promise.all([
        clearAllNativeMediaCache(),
        clearAllNativeResponseCache(),
      ]);
      await loadNativeCacheStats();
      setMessage("本机缓存已清空");
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空本机缓存失败");
    } finally {
      setNativeCacheLoading(false);
    }
  }

  async function handleSaveMediaCacheLimit(nextLimitGb: number) {
    if (!isNativeMobileRuntime) {
      return;
    }

    setNativeCacheLoading(true);
    setError(null);
    try {
      const media = await setNativeMediaCacheMaxGb(nextLimitGb);
      setNativeCacheStats((current) => ({ ...current, media }));
      setMediaCacheLimitGb(mediaCacheBytesToGb(media.maxBytes));
      setMessage("手机媒体缓存空间已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新媒体缓存空间失败");
    } finally {
      setNativeCacheLoading(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const hasPassword = Boolean(profileUser?.has_password);
    if (hasPassword && !passwordValues.currentPassword) {
      setError("请输入当前密码。");
      return;
    }
    if (!passwordValues.newPassword.trim()) {
      setError("请输入新密码。");
      return;
    }
    if (passwordValues.newPassword.length < 6) {
      setError("新密码至少需要 6 位。");
      return;
    }
    if (passwordValues.newPassword !== passwordValues.confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setPasswordSaving(true);
    setError(null);
    try {
      const payload = await changeMyPassword({
        old_password: hasPassword ? passwordValues.currentPassword : undefined,
        new_password: passwordValues.newPassword,
      });
      await refreshUser();
      setPasswordValues(emptyPasswordFormValues());
      setShowPasswordModal(false);
      setMessage(payload.message || (hasPassword ? "密码修改成功" : "密码设置成功"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "密码保存失败");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div style={pageShellStyle(isMobile)}>
      <div style={consoleLayoutStyle(isMobile)}>
        <aside style={sidebarStyle(isMobile)}>
          <div style={sidebarBrandStyle}>
            <div style={eyebrowStyle}>Profile Console</div>
            <div style={sidebarNameStyle}>{profileUser.display_name || profileUser.username}</div>
          </div>
          <nav style={sidebarNavStyle(isMobile)}>
            {SECTION_ITEMS.map((item) => {
              const active = activeSection === item.key;
              return (
                <Link
                  key={item.key}
                  to={profileSectionPath(item.key)}
                  style={sidebarNavButtonStyle(active, isMobile)}
                >
                  <span style={sectionNavLabelStyle}>{item.label}</span>
                  <span style={sectionNavHintStyle(active)}>{item.hint}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div style={consoleContentStyle}>
          {message ? <div style={successBannerStyle}>{message}</div> : null}
          {error ? <div style={errorBannerStyle}>{error}</div> : null}

          {activeSection === "profile" ? (
            <section style={sectionPanelStyle(isMobile)}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={panelEyebrowStyle}>Profile Data</div>
                  <h2 style={panelTitleStyle}>资料</h2>
                </div>
                <div style={profileToolbarStyle}>
                  <button type="button" style={toolbarButtonStyle} onClick={() => setShowPasswordModal(true)}>
                    {profileUser.has_password ? "修改密码" : "设置密码"}
                  </button>
                  <button type="button" style={toolbarDangerButtonStyle} onClick={() => void handleLogout()}>
                    退出登录
                  </button>
                </div>
              </div>

              <div style={profileAvatarRowStyle(isMobile)}>
                <div style={avatarFrameLightStyle}>
                  <CachedImage
                    src={avatarSrc}
                    cacheKey={`profile-avatar:${profileUser.username}`}
                    refreshKey={avatarVersion}
                    alt={profileUser.username}
                    style={avatarStyle(isMobile)}
                  />
                </div>
                <div style={profileAvatarMetaStyle}>
                  <div style={profileAvatarNameStyle}>{profileUser.display_name || profileUser.username}</div>
                  <div style={profileAvatarHintStyle}>
                    @{profileUser.username}
                    {profileAge != null ? ` · ${profileAge} 岁` : ""}
                  </div>
                  <label style={profileUploadLabelStyle}>
                    <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: "none" }} />
                    {uploading ? "Uploading…" : "更新头像"}
                  </label>
                </div>
              </div>

              {profileUser.pending_email ? (
                <div style={pendingEmailBannerStyle}>
                  邮箱 <strong>{profileUser.pending_email}</strong> 待验证：请到该邮箱查收验证邮件并点击链接，验证通过后才会生效并开启
                  <strong> {profileUser.username}@utba.my</strong> 的转发。
                </div>
              ) : null}

              {FIELD_GROUPS.map((group) => (
                <section key={group.title} style={editGroupStyle(isMobile)}>
                  <div style={editGroupTitleStyle}>{group.title}</div>
                  <div style={editListStyle}>
                    {group.fields.map((field) => {
                      const fieldLabel =
                        field.key === "parent_1"
                          ? contactLabels.name
                          : field.key === "parent_1_phone"
                            ? contactLabels.phone
                            : field.label;

                      return (
                        <EditableField
                          key={field.key}
                          field={{ ...field, label: fieldLabel }}
                          value={formValues[field.key]}
                          editing={editingKeys.has(field.key)}
                          saving={savingKey === field.key}
                          isMobile={isMobile}
                          onEdit={() => startEditField(field.key)}
                          onSave={() => void saveField(field.key)}
                          onCancel={() => cancelEditField(field.key)}
                          onChange={(value) => updateField(field.key, value)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}

              <section style={editGroupStyle(isMobile)}>
                <div style={editGroupTitleStyle}>转账资料</div>
                <div style={editListStyle}>
                  {BANK_NOTE_FIELDS.map((field) => (
                    <EditableField
                      key={field.key}
                      field={field}
                      value={formValues[field.key]}
                      editing={editingKeys.has(field.key)}
                      saving={savingKey === field.key}
                      isMobile={isMobile}
                      onEdit={() => startEditField(field.key)}
                      onSave={() => void saveField(field.key)}
                      onCancel={() => cancelEditField(field.key)}
                      onChange={(value) => updateField(field.key, value)}
                    />
                  ))}
                </div>
              </section>
            </section>
          ) : null}

          {activeSection === "journey" ? (
            <section style={sectionPanelStyle(isMobile)}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={panelEyebrowStyle}>My Journey</div>
                  <h2 style={panelTitleStyle}>足迹</h2>
                </div>
                <div style={journeyHeaderAsideStyle(isMobile)}>
                  <span style={nricChipStyle(isMobile)}>{footprints.member?.nric || profileUser.NRIC || "未绑定 NRIC"}</span>
                  <span style={journeyHeaderTextStyle(isMobile)}>系统会按当前账号绑定的成员资料整理参加过什么。</span>
                </div>
              </div>

              {footprintsError ? <div style={errorBannerStyle}>{footprintsError}</div> : null}
              {footprintsLoading ? <div style={stateCardStyle(isMobile)}>正在整理你的报名足迹…</div> : null}

              {!footprintsLoading ? (
                <>
                  <div style={footprintMetricGridStyle(isMobile)}>
                    <FootprintMetric label="足迹总数" value={String(footprintSummary.total_count ?? 0)} />
                    <FootprintMetric label="活动报名" value={String(footprintSummary.registration_form_count ?? 0)} />
                    <FootprintMetric label="关联活动" value={String(footprintSummary.event_count ?? 0)} />
                    <FootprintMetric label="课程报名" value={String(footprintSummary.youth_class_count ?? 0)} />
                    <FootprintMetric label="付款记录" value={String(footprintSummary.payment_count ?? 0)} />
                  </div>

                  {!footprints.member ? (
                    <div style={emptyFootprintStyle}>
                      你的账号还没有绑定成员身份。先在“资料”页签补上 `NRIC`，系统就能帮你整理参加过的报名与课程。
                    </div>
                  ) : null}

                  {footprints.member && !(registrations.length || youthItems.length) ? (
                    <div style={emptyFootprintStyle}>目前还没有查到这张 NRIC 的报名足迹。</div>
                  ) : null}

                  {registrations.length || youthItems.length ? (
                    <div style={journeyTableWrapStyle}>
                      <table style={journeyTableStyle}>
                        <thead>
                          <tr>
                            <th style={journeyThStyle}>类型</th>
                            <th style={journeyThStyle}>名称</th>
                            <th style={journeyThStyle}>详情</th>
                            <th style={journeyThStyle}>日期</th>
                            <th style={journeyThRightStyle}>付款状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {registrations.map((item) => {
                            const events = item.events || [];
                            const headline = events[0]?.event_name || item.title || "未命名报名";
                            return (
                              <tr key={`form-${item.id}`}>
                                <td style={journeyTdStyle}>
                                  <span style={journeyTypeChipStyle("event")}>活动报名</span>
                                </td>
                                <td style={journeyTdStrongStyle}>{headline}</td>
                                <td style={journeyTdMutedStyle}>
                                  关联活动 {String(item.event_count ?? 0)} · 付款 {String(item.payment_count ?? 0)}
                                </td>
                                <td style={journeyTdMutedStyle}>{formatDateTime(item.footprint_at)}</td>
                                <td style={journeyTdRightStyle}>
                                  <FootprintStatusChip
                                    label={paymentStatusLabel(item.latest_payment?.status)}
                                    tone={
                                      item.latest_payment?.status === "checked"
                                        ? "success"
                                        : item.latest_payment?.status === "fail"
                                          ? "danger"
                                          : item.latest_payment?.status === "process"
                                            ? "warning"
                                            : "neutral"
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                          {youthItems.map((item) => (
                            <tr key={`youth-${item.id}`}>
                              <td style={journeyTdStyle}>
                                <span style={journeyTypeChipStyle("youth")}>佛学班</span>
                              </td>
                              <td style={journeyTdStrongStyle}>{item.chinese_name || item.english_name || "青少年报名"}</td>
                              <td style={journeyTdMutedStyle}>
                                {item.category || "未分组"}
                                {item.age != null ? ` · ${item.age} 岁` : ""}
                              </td>
                              <td style={journeyTdMutedStyle}>{formatDateTime(item.footprint_at || item.submitted_at)}</td>
                              <td style={journeyTdRightStyle}>
                                <FootprintStatusChip
                                  label={youthStatusLabel(item.status)}
                                  tone={item.status === "paid" ? "success" : item.status === "reject" ? "danger" : "warning"}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {activeSection === "membership" ? (
            <section style={sectionPanelStyle(isMobile)}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={panelEyebrowStyle}>Membership</div>
                  <h2 style={panelTitleStyle}>会员</h2>
                </div>
                <div style={panelHeaderHintStyle}>查看并管理你的会员绑定与续期。</div>
              </div>

              <article style={featureCardStyle(isMobile)}>
                <div style={featureCardEyebrowStyle}>Membership</div>
                <h3 style={featureCardTitleStyle}>会员状态</h3>
                <div style={featureListStyle}>
                  <InfoRow label="会员身份" value={profileUser.is_member ? "已是会员" : "非会员"} isMobile={isMobile} />
                  <InfoRow label="绑定 NRIC" value={profileUser.NRIC || "未绑定"} isMobile={isMobile} />
                  <InfoRow label="下次到期" value={nextMembershipExpiry || "—"} isMobile={isMobile} />
                </div>
                <MembershipActionCard
                  isMember={Boolean(profileUser.is_member)}
                  hasBoundNric={hasBoundNric}
                  nextExpiryDate={nextMembershipExpiry}
                  actionBusy={membershipActionBusy}
                  isMobile={isMobile}
                  onAction={() => void handleMembershipAction()}
                />
              </article>
            </section>
          ) : null}

          {activeSection === "email" ? (
            <section style={sectionPanelStyle(isMobile)}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={panelEyebrowStyle}>Mailbox</div>
                  <h2 style={panelTitleStyle}>邮件</h2>
                </div>
                <div style={panelHeaderHintStyle}>使用公司邮箱发送邮件，并查看已发送记录。</div>
              </div>

              <EmailPanel
                isMobile={isMobile}
                username={profileUser.username}
                displayName={profileUser.display_name || profileUser.username}
              />
            </section>
          ) : null}

          {activeSection === "app" ? (
            <section style={sectionPanelStyle(isMobile)}>
              <div style={panelHeaderStyle}>
                <div>
                  <div style={panelEyebrowStyle}>Download</div>
                  <h2 style={panelTitleStyle}>下载 App</h2>
                </div>
                <div style={panelHeaderHintStyle}>获取最新版本的手机 App，以及手机端缓存设置。</div>
              </div>

              <AppDownloadCard releases={appReleases} loading={appReleasesLoading} isMobile={isMobile} />

              {isNativeMobileRuntime ? (
                <NativeCacheDebugCard
                  stats={nativeCacheStats}
                  loading={nativeCacheLoading}
                  isMobile={isMobile}
                  mediaLimitGb={mediaCacheLimitGb}
                  onMediaLimitChange={setMediaCacheLimitGb}
                  onSaveMediaLimit={(value) => void handleSaveMediaCacheLimit(value)}
                  onRefresh={() => void handleRefreshNativeCaches()}
                  onTrim={() => void handleTrimNativeCaches()}
                  onClear={() => void handleClearNativeCaches()}
                />
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      {showPasswordModal ? (
        <div style={modalOverlayStyle} onClick={() => setShowPasswordModal(false)}>
          <div style={modalCardStyle(isMobile)} onClick={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={modalTitleStyle}>{profileUser.has_password ? "修改密码" : "设置密码"}</h3>
              <button
                type="button"
                style={iconButtonStyle("plain")}
                onClick={() => setShowPasswordModal(false)}
                aria-label="关闭"
              >
                <CloseIcon />
              </button>
            </div>
            <form style={profileFormStackStyle} onSubmit={handlePasswordSubmit}>
              {profileUser.has_password ? (
                <label style={fieldStyle}>
                  <span style={fieldLabelStyle}>当前密码</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={passwordValues.currentPassword}
                    onChange={(event) => updatePasswordField("currentPassword", event.target.value)}
                    style={inputStyle}
                  />
                </label>
              ) : (
                <div style={footprintNoteStyle}>
                  当前账号还没有设置密码。保存后，你就可以用 `username + 新密码` 登录。
                </div>
              )}

              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwordValues.newPassword}
                  onChange={(event) => updatePasswordField("newPassword", event.target.value)}
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>确认新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwordValues.confirmPassword}
                  onChange={(event) => updatePasswordField("confirmPassword", event.target.value)}
                  style={inputStyle}
                />
              </label>

              <div style={fieldHintStyle}>密码至少 6 位。保存后，新密码会立即生效。</div>

              <div style={formActionsStyle(isMobile)}>
                <button
                  type="button"
                  style={ghostButtonStyle}
                  disabled={passwordSaving}
                  onClick={() => setShowPasswordModal(false)}
                >
                  取消
                </button>
                <button type="submit" style={primaryButtonStyle} disabled={passwordSaving}>
                  {passwordSaving ? "保存中…" : profileUser.has_password ? "更新密码" : "设置密码"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: {
    key: keyof ProfileFormValues;
    label: string;
    type?: "text" | "email" | "tel" | "textarea" | "select";
    options?: Array<{ label: string; value: string }>;
    readOnly?: boolean;
  };
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === "textarea") {
    return (
      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={field.readOnly ? readOnlyTextareaStyle : textareaStyle}
        readOnly={field.readOnly}
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
      style={field.readOnly ? readOnlyInputStyle : inputStyle}
      readOnly={field.readOnly}
    />
  );
}

function PenIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function EditableField({
  field,
  value,
  editing,
  saving,
  isMobile,
  onEdit,
  onSave,
  onCancel,
  onChange,
}: {
  field: {
    key: keyof ProfileFormValues;
    label: string;
    type?: "text" | "email" | "tel" | "textarea" | "select";
    options?: Array<{ label: string; value: string }>;
    readOnly?: boolean;
  };
  value: string;
  editing: boolean;
  saving: boolean;
  isMobile: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (value: string) => void;
}) {
  const locked = Boolean(field.readOnly);
  const displayValue = field.options
    ? (field.options.find((option) => option.value === value)?.label ?? (value || "—"))
    : value || "—";
  const isEditing = editing && !locked;

  return (
    <div style={editRowStyle(isMobile)}>
      <span style={editRowLabelStyle(isMobile)}>{field.label}</span>
      <div style={editRowMainStyle}>
        <div style={editRowControlStyle}>
          {isEditing ? (
            <FieldControl field={field} value={value} onChange={onChange} />
          ) : (
            <div style={editRowValueStyle(locked, field.type === "textarea")}>{displayValue}</div>
          )}
        </div>
        {locked ? (
          <span style={editRowLockStyle}>只读</span>
        ) : isEditing ? (
          <div style={editRowIconsStyle}>
            <button
              type="button"
              style={iconButtonStyle("save")}
              onClick={onSave}
              disabled={saving}
              title="保存"
              aria-label="保存"
            >
              <SaveIcon />
            </button>
            <button
              type="button"
              style={iconButtonStyle("cancel")}
              onClick={onCancel}
              disabled={saving}
              title="取消"
              aria-label="取消"
            >
              <CloseIcon />
            </button>
          </div>
        ) : (
          <div style={editRowIconsStyle}>
            <button type="button" style={iconButtonStyle("edit")} onClick={onEdit} title="编辑" aria-label="编辑">
              <PenIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HeroMetric({
  label,
  value,
  hint,
  isMobile,
  wideOnMobile = false,
}: {
  label: string;
  value: string;
  hint: string;
  isMobile: boolean;
  wideOnMobile?: boolean;
}) {
  return (
    <div style={heroMetricCardStyle(isMobile, wideOnMobile)}>
      <div style={heroMetricLabelStyle}>{label}</div>
      <div style={heroMetricValueStyle(value, isMobile)}>{value}</div>
      <div style={heroMetricHintStyle}>{hint}</div>
    </div>
  );
}

function FootprintMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={footprintMetricCardStyle}>
      <div style={footprintMetricLabelStyle}>{label}</div>
      <div style={footprintMetricValueStyle}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value, isMobile }: { label: string; value: string; isMobile: boolean }) {
  return (
    <div style={infoRowStyle(isMobile)}>
      <span style={infoRowLabelStyle(isMobile)}>{label}</span>
      <span style={infoRowValueStyle(isMobile)}>{value}</span>
    </div>
  );
}

function FootprintStatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return <span style={statusChipStyle(tone)}>{label}</span>;
}

function FormFootprintCard({ item }: { item: ProfileFormFootprint }) {
  const latestPayment = item.latest_payment;
  const events = item.events || [];
  const headline = events[0]?.event_name || item.title || "未命名报名";

  return (
    <article style={footprintCardStyle}>
      <div style={footprintCardHeaderStyle}>
        <div>
          <div style={footprintCardEyebrowStyle}>活动报名</div>
          <h3 style={footprintCardTitleStyle}>{headline}</h3>
          <div style={footprintCardMetaStyle}>
            {item.title && item.title !== headline ? item.title : "报名表记录"} · 最近记录 {formatDateTime(item.footprint_at)}
          </div>
        </div>
        <FootprintStatusChip
          label={paymentStatusLabel(latestPayment?.status)}
          tone={
            latestPayment?.status === "checked"
              ? "success"
              : latestPayment?.status === "fail"
                ? "danger"
                : latestPayment?.status === "process"
                  ? "warning"
                  : "neutral"
          }
        />
      </div>

      <div style={footprintFactGridStyle}>
        <div style={footprintFactStyle}>
          <span style={footprintFactLabelStyle}>活动数</span>
          <span style={footprintFactValueStyle}>{String(item.event_count ?? 0)}</span>
        </div>
        <div style={footprintFactStyle}>
          <span style={footprintFactLabelStyle}>付款记录</span>
          <span style={footprintFactValueStyle}>{String(item.payment_count ?? 0)}</span>
        </div>
        <div style={footprintFactStyle}>
          <span style={footprintFactLabelStyle}>资料名</span>
          <span style={footprintFactValueStyle}>{item.profile_name || "未记录"}</span>
        </div>
      </div>

      {events.length ? (
        <div style={footprintEventListStyle}>
          {events.map((event) => (
            <div key={event.id} style={footprintEventRowStyle}>
              <div style={footprintEventNameStyle}>{event.event_name || "未命名活动"}</div>
              <div style={footprintEventMetaStyle}>
                {formatDateTime(event.datetime)}
                {event.location ? ` · ${event.location}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={footprintNoteStyle}>这条足迹目前没有关联活动资料，系统先展示报名表记录。</div>
      )}
    </article>
  );
}

function YouthFootprintCard({ item }: { item: ProfileYouthFootprint }) {
  return (
    <article style={footprintCardStyle}>
      <div style={footprintCardHeaderStyle}>
        <div>
          <div style={footprintCardEyebrowStyle}>课程报名</div>
          <h3 style={footprintCardTitleStyle}>{item.chinese_name || item.english_name || "青少年报名"}</h3>
          <div style={footprintCardMetaStyle}>
            {item.category || "未分组"} · 提交时间 {formatDateTime(item.footprint_at || item.submitted_at)}
          </div>
        </div>
        <FootprintStatusChip
          label={youthStatusLabel(item.status)}
          tone={item.status === "paid" ? "success" : item.status === "reject" ? "danger" : "warning"}
        />
      </div>

      <div style={footprintFactGridStyle}>
        <div style={footprintFactStyle}>
          <span style={footprintFactLabelStyle}>年龄</span>
          <span style={footprintFactValueStyle}>{item.age != null ? `${item.age} 岁` : "未记录"}</span>
        </div>
        <div style={footprintFactStyle}>
          <span style={footprintFactLabelStyle}>手机</span>
          <span style={footprintFactValueStyle}>{item.phone || "未记录"}</span>
        </div>
        <div style={footprintFactStyle}>
          <span style={footprintFactLabelStyle}>付款次数</span>
          <span style={footprintFactValueStyle}>{String(item.payment_count ?? 0)}</span>
        </div>
      </div>

      <div style={footprintNoteStyle}>
        最近付款状态：{paymentStatusLabel(item.latest_payment?.status)}
        {item.address ? ` · 地址 ${item.address}` : ""}
      </div>
    </article>
  );
}

function NativeCacheDebugCard({
  stats,
  loading,
  isMobile,
  mediaLimitGb,
  onMediaLimitChange,
  onSaveMediaLimit,
  onRefresh,
  onTrim,
  onClear,
}: {
  stats: NativeCacheDebugStats;
  loading: boolean;
  isMobile: boolean;
  mediaLimitGb: number;
  onMediaLimitChange: (value: number) => void;
  onSaveMediaLimit: (value: number) => void;
  onRefresh: () => void;
  onTrim: () => void;
  onClear: () => void;
}) {
  const media = stats.media ?? emptyNativeCacheStats();
  const response = stats.response ?? emptyNativeCacheStats();
  const trimmedEntries = Number(media.trimmedEntries || 0) + Number(response.trimmedEntries || 0);
  const trimmedBytes = Number(media.trimmedBytes || 0) + Number(response.trimmedBytes || 0);
  const normalizedLimitGb = Math.min(
    NATIVE_MEDIA_CACHE_MAX_GB,
    Math.max(NATIVE_MEDIA_CACHE_MIN_GB, Math.round(mediaLimitGb || NATIVE_MEDIA_CACHE_DEFAULT_GB)),
  );

  return (
    <article style={featureCardStyle(isMobile)}>
      <div style={featureCardEyebrowStyle}>Mobile Settings</div>
      <h3 style={featureCardTitleStyle}>手机设置</h3>
      <div style={mobileSettingBlockStyle}>
        <div style={mobileSettingHeaderStyle}>
          <span style={fieldLabelStyle}>媒体缓存空间</span>
          <span style={mobileSettingValueStyle}>{normalizedLimitGb} GB</span>
        </div>
        <input
          type="range"
          min={NATIVE_MEDIA_CACHE_MIN_GB}
          max={NATIVE_MEDIA_CACHE_MAX_GB}
          step={1}
          value={normalizedLimitGb}
          disabled={loading}
          onChange={(event) => onMediaLimitChange(Number(event.target.value))}
          style={rangeInputStyle}
        />
        <div style={mobileSettingFooterStyle}>
          <input
            type="number"
            min={NATIVE_MEDIA_CACHE_MIN_GB}
            max={NATIVE_MEDIA_CACHE_MAX_GB}
            step={1}
            value={normalizedLimitGb}
            disabled={loading}
            onChange={(event) => onMediaLimitChange(Number(event.target.value))}
            style={smallNumberInputStyle}
          />
          <button
            type="button"
            style={actionButtonStateStyle(softPrimaryButtonStyle, loading)}
            disabled={loading}
            onClick={() => onSaveMediaLimit(normalizedLimitGb)}
          >
            保存
          </button>
        </div>
      </div>

      <h3 style={featureCardTitleStyle}>本机缓存</h3>
      <div style={featureListStyle}>
        <InfoRow
          label="媒体缓存"
          value={`${media.entryCount ?? 0} 条 · ${formatBytes(media.totalBytes)}`}
          isMobile={isMobile}
        />
        <InfoRow label="媒体上限" value={formatBytes(media.maxBytes)} isMobile={isMobile} />
        <InfoRow
          label="响应缓存"
          value={`${response.entryCount ?? 0} 条 · ${formatBytes(response.totalBytes)}`}
          isMobile={isMobile}
        />
        <InfoRow label="响应上限" value={formatBytes(response.maxBytes)} isMobile={isMobile} />
      </div>
      {trimmedEntries > 0 || trimmedBytes > 0 ? (
        <div style={fieldHintStyle}>
          上次裁剪：{trimmedEntries} 条 · {formatBytes(trimmedBytes)}
        </div>
      ) : null}
      <div style={nativeCacheActionsStyle(isMobile)}>
        <button
          type="button"
          style={actionButtonStateStyle(ghostButtonStyle, loading)}
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "读取中…" : "刷新"}
        </button>
        <button
          type="button"
          style={actionButtonStateStyle(softPrimaryButtonStyle, loading)}
          disabled={loading}
          onClick={onTrim}
        >
          裁剪
        </button>
        <button
          type="button"
          style={actionButtonStateStyle(dangerButtonStyle, loading)}
          disabled={loading}
          onClick={onClear}
        >
          清空
        </button>
      </div>
    </article>
  );
}

function AppDownloadCard({
  releases,
  loading,
  isMobile,
}: {
  releases: AppRelease[];
  loading: boolean;
  isMobile: boolean;
}) {
  function handleDownload(release: AppRelease) {
    try {
      downloadUrl(release.download_url, release.filename);
    } catch (error) {
      console.warn("APK download failed:", error);
    }
  }

  return (
    <article style={featureCardStyle(isMobile)}>
      <div style={featureCardEyebrowStyle}>App Download</div>
      <h3 style={featureCardTitleStyle}>下载 App</h3>
      {loading ? (
        <div style={footprintNoteStyle}>正在加载版本列表…</div>
      ) : releases.length === 0 ? (
        <div style={footprintNoteStyle}>暂无可下载的 App 版本。</div>
      ) : (
        <div style={apkListStyle}>
          {releases.map((r) => (
            <div key={r.filename} style={apkRowStyle(isMobile)}>
              <div style={apkInfoStyle}>
                <span style={apkNameStyle}>{r.filename}</span>
                <span style={apkSizeStyle}>{r.size_label}</span>
              </div>
              <button type="button" style={apkDownloadButtonStyle(isMobile)} onClick={() => handleDownload(r)}>
                下载
              </button>
            </div>
          ))}
        </div>
      )}
      {!loading && <div style={footprintNoteStyle}>Android APK 安装包，下载后在手机上打开即可安装。</div>}
    </article>
  );
}

const apkListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

function apkRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: isMobile ? "grid" : "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 14px",
    borderRadius: "14px",
    background: "rgba(15,118,110,0.06)",
    border: "1px solid rgba(15,118,110,0.12)",
  };
}

const apkInfoStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  minWidth: 0,
};

const apkNameStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: "14px",
  color: "var(--x-color-ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const apkSizeStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

function apkDownloadButtonStyle(isMobile: boolean): CSSProperties {
  return {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: isMobile ? "100%" : "auto",
    padding: "8px 16px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #0f766e, #1d4ed8)",
    color: "white",
    fontWeight: 700,
    fontSize: "13px",
    textDecoration: "none",
    boxSizing: "border-box",
  };
}

function pageShellStyle(isMobile: boolean): CSSProperties {
  return {
    minHeight: "calc(100vh - 60px)",
    padding: isMobile ? "18px 14px 32px" : "28px clamp(18px, 4vw, 40px) 48px",
    overflowX: "hidden",
    background:
      "radial-gradient(circle at top left, rgba(15,118,110,0.18), transparent 32%), linear-gradient(180deg, #eef5f4, #e5edf4 42%, #f6f8fb)",
    color: "var(--x-color-ink)",
    fontFamily: "var(--x-font-sans)",
    display: "grid",
    gap: isMobile ? "16px" : "20px",
  };
}

function heroShellStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "16px",
    borderRadius: isMobile ? "16px" : "18px",
    background:
      "linear-gradient(145deg, rgba(11,31,38,0.96), rgba(19,78,74,0.94) 58%, rgba(221,107,32,0.88) 120%)",
    boxShadow: "0 14px 34px rgba(15,23,42,0.12)",
    color: "white",
  };
}

const heroContentStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

function heroHeaderRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.5fr) minmax(240px, 0.5fr)",
    gap: "18px",
    alignItems: "center",
  };
}

const heroIdentityWrapStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  opacity: 0.76,
};

function heroTitleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "clamp(22px, 6vw, 26px)" : "clamp(22px, 2.4vw, 28px)",
    lineHeight: 1.05,
    letterSpacing: "-0.02em",
  };
}

const heroBodyStyle: CSSProperties = {
  margin: 0,
  maxWidth: "62ch",
  lineHeight: 1.5,
  opacity: 0.82,
  fontSize: "13px",
};

function heroAvatarPanelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    justifyItems: isMobile ? "start" : "end",
    gap: "12px",
  };
}

const avatarFrameStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "fit-content",
  padding: "6px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.16)",
  backdropFilter: "blur(12px)",
};

function avatarStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "72px" : "96px",
    height: isMobile ? "72px" : "96px",
    borderRadius: "14px",
    objectFit: "cover",
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
  };
}

function avatarUploadLabelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: isMobile ? "100%" : "140px",
    width: isMobile ? "100%" : undefined,
    padding: "11px 16px",
    borderRadius: "999px",
    cursor: "pointer",
    background: "rgba(255,255,255,0.14)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    boxSizing: "border-box",
    fontWeight: 700,
  };
}

function heroMetricsGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))",
    gap: "8px",
  };
}

function heroMetricCardStyle(isMobile: boolean, wideOnMobile: boolean): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: "12px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.16)",
    minWidth: 0,
    gridColumn: isMobile && wideOnMobile ? "1 / -1" : undefined,
  };
}

const heroMetricLabelStyle: CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  opacity: 0.68,
};

function heroMetricValueStyle(value: string, isMobile: boolean): CSSProperties {
  const isLongValue = value.length > 10;
  return {
    marginTop: "4px",
    fontSize: isMobile ? (isLongValue ? "clamp(15px, 4.5vw, 17px)" : "18px") : isLongValue ? "16px" : "18px",
    fontWeight: 800,
    lineHeight: isLongValue ? 1.15 : 1.05,
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    whiteSpace: "normal",
  };
}

const heroMetricHintStyle: CSSProperties = {
  marginTop: "3px",
  fontSize: "11px",
  opacity: 0.7,
};

const sectionNavWrapStyle: CSSProperties = {
  position: "sticky",
  top: "10px",
  zIndex: 10,
};

function sectionNavStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : `repeat(${SECTION_ITEMS.length}, minmax(0, 1fr))`,
    gap: isMobile ? "8px" : "10px",
    padding: isMobile ? "8px" : "10px",
    borderRadius: isMobile ? "18px" : "22px",
    background: "rgba(255,255,255,0.78)",
    border: "1px solid rgba(216,223,235,0.85)",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    backdropFilter: "blur(18px)",
  };
}

function sectionNavButtonStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    border: "none",
    borderRadius: "16px",
    padding: isMobile ? "12px 13px" : "14px 16px",
    cursor: "pointer",
    display: "grid",
    gap: "4px",
    textAlign: "left",
    minWidth: 0,
    textDecoration: "none",
    background: active
      ? "linear-gradient(135deg, rgba(15,118,110,0.16), rgba(221,107,32,0.14))"
      : "rgba(255,255,255,0.56)",
    boxShadow: active ? "inset 0 0 0 1px rgba(15,118,110,0.14)" : "none",
    color: "var(--x-color-ink)",
  };
}

const sectionNavLabelStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
};

function sectionNavHintStyle(active: boolean): CSSProperties {
  return {
    fontSize: "12px",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
  };
}

// ---- Console layout: left sidebar + content column ----
function consoleLayoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "200px minmax(0, 1fr)",
    gap: isMobile ? "12px" : "16px",
    alignItems: "start",
  };
}

function sidebarStyle(isMobile: boolean): CSSProperties {
  return {
    position: isMobile ? "static" : "sticky",
    top: "16px",
    alignSelf: "start",
    display: "grid",
    gap: isMobile ? "10px" : "12px",
    padding: isMobile ? "10px" : "12px",
    borderRadius: "16px",
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(216,223,235,0.9)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
  };
}

const consoleContentStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  minWidth: 0,
};

const sidebarBrandStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  padding: "6px 8px",
};

const sidebarNameStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  lineHeight: 1.2,
  color: "var(--x-color-ink)",
  overflowWrap: "anywhere",
};

function sidebarNavStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "1fr",
    gap: "6px",
  };
}

function sidebarNavButtonStyle(active: boolean, _isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "2px",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    textDecoration: "none",
    minWidth: 0,
    background: active
      ? "linear-gradient(135deg, rgba(15,118,110,0.16), rgba(221,107,32,0.14))"
      : "transparent",
    boxShadow: active ? "inset 0 0 0 1px rgba(15,118,110,0.16)" : "none",
    color: "var(--x-color-ink)",
  };
}

// ---- Avatar block inside 资料 ----
function profileAvatarRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? "12px" : "16px",
    padding: isMobile ? "12px" : "14px",
    borderRadius: "12px",
    background: "linear-gradient(135deg, rgba(15,118,110,0.06), rgba(221,107,32,0.05))",
    border: "1px solid rgba(216,223,235,0.9)",
  };
}

const avatarFrameLightStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "fit-content",
  padding: "5px",
  borderRadius: "16px",
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(216,223,235,0.9)",
};

const profileAvatarMetaStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: 0,
};

const profileAvatarNameStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  lineHeight: 1.2,
  color: "var(--x-color-ink)",
  overflowWrap: "anywhere",
};

const profileAvatarHintStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const profileUploadLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "fit-content",
  marginTop: "4px",
  padding: "8px 14px",
  borderRadius: "999px",
  cursor: "pointer",
  background: "rgba(15,118,110,0.08)",
  color: "var(--x-color-accent-strong)",
  border: "1px solid rgba(15,118,110,0.16)",
  fontWeight: 700,
  fontSize: "13px",
};

// ---- 足迹 table ----
const journeyTableWrapStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid rgba(216,223,235,0.9)",
  borderRadius: "12px",
};

const journeyTableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  minWidth: "560px",
};

const journeyThStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  background: "rgba(245,248,251,0.9)",
  borderBottom: "1px solid rgba(216,223,235,0.9)",
  whiteSpace: "nowrap",
};

const journeyThRightStyle: CSSProperties = {
  ...journeyThStyle,
  textAlign: "right",
};

const journeyTdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(216,223,235,0.6)",
  verticalAlign: "middle",
  color: "var(--x-color-ink)",
};

const journeyTdStrongStyle: CSSProperties = {
  ...journeyTdStyle,
  fontWeight: 700,
};

const journeyTdMutedStyle: CSSProperties = {
  ...journeyTdStyle,
  color: "var(--x-color-ink-muted)",
  whiteSpace: "nowrap",
};

const journeyTdRightStyle: CSSProperties = {
  ...journeyTdStyle,
  textAlign: "right",
  whiteSpace: "nowrap",
};

function journeyTypeChipStyle(kind: "event" | "youth"): CSSProperties {
  const isEvent = kind === "event";
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    background: isEvent ? "rgba(15,118,110,0.1)" : "rgba(221,107,32,0.12)",
    color: isEvent ? "var(--x-color-accent-strong)" : "#c2410c",
  };
}

// ---- 资料 toolbar ----
const profileToolbarStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const toolbarButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "999px",
  border: "1px solid rgba(15,118,110,0.16)",
  background: "rgba(15,118,110,0.08)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
};

const toolbarDangerButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "999px",
  border: "1px solid rgba(194,65,12,0.22)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
};

const pendingEmailBannerStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  background: "rgba(202,138,4,0.12)",
  border: "1px solid rgba(202,138,4,0.28)",
  color: "#854d0e",
  fontSize: "13px",
  lineHeight: 1.6,
};

// ---- inline-editable field rows ----
function editGroupStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "2px",
    padding: isMobile ? "10px 12px" : "12px 14px",
    borderRadius: "12px",
    background: "#fff",
    border: "1px solid rgba(216,223,235,0.9)",
  };
}

const editGroupTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "var(--x-color-ink-muted)",
  padding: "2px 0 6px",
};

const editListStyle: CSSProperties = {
  display: "grid",
};

function editRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: isMobile ? "grid" : "flex",
    alignItems: isMobile ? "stretch" : "center",
    gap: isMobile ? "4px" : "12px",
    padding: "9px 0",
    borderBottom: "1px solid rgba(216,223,235,0.6)",
  };
}

function editRowLabelStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "auto" : "120px",
    flex: "none",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
  };
}

const editRowMainStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flex: 1,
  minWidth: 0,
};

const editRowControlStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

function editRowValueStyle(locked: boolean, multiline: boolean): CSSProperties {
  return {
    fontSize: "13px",
    fontWeight: 600,
    color: locked ? "var(--x-color-ink-muted)" : "var(--x-color-ink)",
    lineHeight: 1.5,
    whiteSpace: multiline ? "pre-wrap" : "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
}

const editRowIconsStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flex: "none",
};

const editRowLockStyle: CSSProperties = {
  flex: "none",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
  opacity: 0.7,
};

function iconButtonStyle(variant: "edit" | "save" | "cancel" | "plain"): CSSProperties {
  const palette =
    variant === "save"
      ? { bg: "rgba(15,118,110,0.1)", color: "var(--x-color-accent-strong)", border: "rgba(15,118,110,0.2)" }
      : variant === "cancel"
        ? { bg: "rgba(148,163,184,0.12)", color: "var(--x-color-ink-muted)", border: "rgba(148,163,184,0.25)" }
        : { bg: "transparent", color: "var(--x-color-ink-muted)", border: "rgba(216,223,235,0.9)" };
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "8px",
    border: `1px solid ${palette.border}`,
    background: palette.bg,
    color: palette.color,
    cursor: "pointer",
    padding: 0,
  };
}

// ---- password modal ----
const modalOverlayStyle: CSSProperties = {
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
    maxWidth: isMobile ? "100%" : "420px",
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

function sectionPanelStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "16px",
    borderRadius: isMobile ? "14px" : "16px",
    overflow: "hidden",
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(216,223,235,0.9)",
    boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
    display: "grid",
    gap: isMobile ? "12px" : "14px",
  };
}

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  flexWrap: "wrap",
};

const panelEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const panelTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "18px",
  lineHeight: 1.1,
  color: "var(--x-color-ink)",
};

const panelHeaderHintStyle: CSSProperties = {
  maxWidth: "34ch",
  minWidth: 0,
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.5,
  fontSize: "12px",
};

function overviewGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
    gap: "1px",
    background: "rgba(216,223,235,0.9)",
    border: "1px solid rgba(216,223,235,0.9)",
    borderRadius: "12px",
    overflow: "hidden",
  };
}

function featureCardStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "14px",
    borderRadius: "12px",
    background: "#fff",
    border: "1px solid rgba(216,223,235,0.9)",
    display: "grid",
    gap: isMobile ? "10px" : "10px",
    minWidth: 0,
  };
}

// overview 控制台分区：作为 overviewGrid 内部的格子，去掉自身圆角/边框，
// 靠父容器 1px gap 形成整齐的分隔线。
function overviewCellStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "14px",
    background: "#fff",
    display: "grid",
    gap: "10px",
    minWidth: 0,
  };
}

const featureCardEyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const featureCardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  fontWeight: 800,
  lineHeight: 1.2,
};

const featureListStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const featureCardFooterStyle: CSSProperties = {
  marginTop: "auto",
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const latestFootprintStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const latestFootprintTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  lineHeight: 1.25,
};

const latestFootprintMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const journeyKindChipStyle: CSSProperties = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  padding: "7px 10px",
  borderRadius: "999px",
  background: "rgba(15,118,110,0.08)",
  color: "var(--x-color-accent-strong)",
  fontSize: "12px",
  fontWeight: 800,
};

const featureChecklistStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

function checkItemStyle(filled: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "7px 10px",
    borderRadius: "8px",
    fontSize: "13px",
    background: filled ? "rgba(15,118,110,0.06)" : "rgba(148,163,184,0.08)",
    color: "var(--x-color-ink)",
  };
}

function infoRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: isMobile ? "grid" : "flex",
    justifyContent: isMobile ? undefined : "space-between",
    gap: isMobile ? "2px" : "14px",
    alignItems: isMobile ? "flex-start" : "center",
    padding: "6px 0",
    borderBottom: "1px solid rgba(216,223,235,0.65)",
  };
}

function infoRowLabelStyle(isMobile: boolean): CSSProperties {
  return {
    color: "var(--x-color-ink-muted)",
    fontSize: isMobile ? "12px" : "13px",
  };
}

function infoRowValueStyle(isMobile: boolean): CSSProperties {
  return {
    fontWeight: 700,
    fontSize: isMobile ? "13px" : "13px",
    textAlign: isMobile ? "left" : "right",
    minWidth: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    whiteSpace: isMobile ? "normal" : "nowrap",
    overflow: isMobile ? undefined : "hidden",
    textOverflow: isMobile ? undefined : "ellipsis",
    lineHeight: isMobile ? 1.45 : 1.3,
  };
}

const profileFormStackStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

function groupCardStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "16px" : "18px",
    borderRadius: isMobile ? "18px" : "22px",
    background: "linear-gradient(180deg, rgba(250,251,253,0.98), rgba(244,248,250,0.98))",
    border: "1px solid rgba(216,223,235,0.9)",
    display: "grid",
    gap: "14px",
  };
}

const groupHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
};

const groupTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
};

const groupDescStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

function groupFieldGridStyle(isMobile: boolean): CSSProperties {
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
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const fieldHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "48px",
  padding: "12px 14px",
  borderRadius: "16px",
  border: "1px solid rgba(203,213,225,0.9)",
  background: "white",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
  fontSize: "14px",
  boxSizing: "border-box",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "118px",
  resize: "vertical",
};

const readOnlyInputStyle: CSSProperties = {
  ...inputStyle,
  background: "rgba(241,245,249,0.92)",
  color: "var(--x-color-ink-muted)",
};

const readOnlyTextareaStyle: CSSProperties = {
  ...textareaStyle,
  background: "rgba(241,245,249,0.92)",
  color: "var(--x-color-ink-muted)",
};

function formActionsStyle(isMobile: boolean): CSSProperties {
  if (isMobile) {
    return {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "10px",
    };
  }

  return {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    flexWrap: "wrap",
  };
}

function journeyHeaderAsideStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    justifyItems: isMobile ? "start" : "end",
    gap: "8px",
  };
}

function journeyHeaderTextStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
    textAlign: isMobile ? "left" : "right",
    lineHeight: 1.6,
  };
}

function nricChipStyle(isMobile: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    padding: isMobile ? "8px 12px" : "9px 14px",
    borderRadius: "999px",
    background: "rgba(15,118,110,0.1)",
    color: "var(--x-color-accent-strong)",
    fontWeight: 700,
    fontSize: isMobile ? "13px" : "14px",
    border: "1px solid rgba(15,118,110,0.12)",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.4,
  };
}

function footprintMetricGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))",
    gap: "14px",
  };
}

const footprintMetricCardStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "20px",
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(216,223,235,0.9)",
  boxShadow: "0 14px 28px rgba(15,23,42,0.05)",
};

const footprintMetricLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const footprintMetricValueStyle: CSSProperties = {
  marginTop: "10px",
  fontSize: "28px",
  fontWeight: 800,
  lineHeight: 1,
};

const footprintSectionStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const sectionSubtitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const footprintListStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const emptyFootprintStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.84)",
  border: "1px dashed rgba(148,163,184,0.55)",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
};

const emptyInlineStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(148,163,184,0.08)",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
};

const footprintCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "20px",
  background: "white",
  border: "1px solid rgba(216,223,235,0.9)",
  boxShadow: "0 14px 28px rgba(15,23,42,0.05)",
  display: "grid",
  gap: "14px",
};

const footprintCardHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  flexWrap: "wrap",
};

const footprintCardEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const footprintCardTitleStyle: CSSProperties = {
  margin: "6px 0 4px",
  fontSize: "20px",
  lineHeight: 1.2,
  color: "var(--x-color-ink)",
};

const footprintCardMetaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.6,
};

function statusChipStyle(tone: "neutral" | "success" | "warning" | "danger"): CSSProperties {
  const palette = {
    neutral: {
      background: "rgba(148,163,184,0.12)",
      color: "var(--x-color-ink-muted)",
      border: "1px solid rgba(148,163,184,0.16)",
    },
    success: {
      background: "var(--x-color-success-soft)",
      color: "var(--x-color-success)",
      border: "1px solid rgba(34,197,94,0.18)",
    },
    warning: {
      background: "rgba(245,158,11,0.12)",
      color: "#b45309",
      border: "1px solid rgba(245,158,11,0.18)",
    },
    danger: {
      background: "var(--x-color-danger-soft)",
      color: "var(--x-color-danger)",
      border: "1px solid rgba(194,65,12,0.16)",
    },
  }[tone];

  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: 700,
    ...palette,
  };
}

const footprintFactGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "12px",
};

const footprintFactStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid rgba(216,223,235,0.9)",
};

const footprintFactLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const footprintFactValueStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  lineHeight: 1.5,
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const footprintEventListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const footprintEventRowStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(15,118,110,0.05)",
  border: "1px solid rgba(15,118,110,0.08)",
};

const footprintEventNameStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const footprintEventMetaStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.6,
};

const footprintNoteStyle: CSSProperties = {
  fontSize: "14px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
};

function accountGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "16px",
  };
}

const accountActionListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const mobileSettingBlockStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "14px",
  borderRadius: "16px",
  background: "rgba(15,118,110,0.06)",
  border: "1px solid rgba(15,118,110,0.12)",
};

const mobileSettingHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const mobileSettingValueStyle: CSSProperties = {
  fontWeight: 800,
  color: "var(--x-color-accent-strong)",
  whiteSpace: "nowrap",
};

const mobileSettingFooterStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(88px, 120px) minmax(0, 1fr)",
  gap: "10px",
  alignItems: "center",
};

const rangeInputStyle: CSSProperties = {
  width: "100%",
  accentColor: "var(--x-color-accent-strong)",
};

const smallNumberInputStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "44px",
  padding: "10px 12px",
};

function nativeCacheActionsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
    gap: "10px",
  };
}

function actionButtonStateStyle(baseStyle: CSSProperties, disabled: boolean): CSSProperties {
  return {
    ...baseStyle,
    minWidth: 0,
    opacity: disabled ? 0.62 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, #0f766e, #dd6b20)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const softPrimaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid rgba(15,118,110,0.14)",
  background: "rgba(15,118,110,0.08)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  cursor: "pointer",
};

// overview 控制台分区底部的紧凑文字链接，取代大按钮以减轻视觉重量。
const overviewLinkStyle: CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  fontSize: "12px",
  cursor: "pointer",
  textAlign: "left",
};

const ghostButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid rgba(203,213,225,0.9)",
  background: "white",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
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
  padding: "14px 18px",
  borderRadius: "18px",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};

const errorBannerStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: "18px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

function stateCardStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "720px",
    margin: "48px auto",
    padding: isMobile ? "20px" : "24px",
    borderRadius: "24px",
    background: "rgba(255,255,255,0.94)",
    boxShadow: "0 24px 60px rgba(15,23,42,0.08)",
    textAlign: "center",
  };
}

function gateCardStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "720px",
    margin: "48px auto",
    padding: isMobile ? "24px" : "32px",
    borderRadius: "28px",
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
