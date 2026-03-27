import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { ensureDesignTokens } from "../../theme/designTokens";
import { API_BASE } from "../../js/apiBase";
import { fetchAppReleases, fetchMyFootprints, startMembershipRenewal, updateProfile, uploadProfileImage } from "./api";
import { MembershipActionCard } from "./MembershipActionCard";
import type {
  AppRelease,
  ProfileFootprintPayload,
  ProfileFootprintSummary,
  ProfileFormFootprint,
  ProfileFormValues,
  ProfileUser,
  ProfileYouthFootprint,
} from "./types";

type ProfileSectionKey = "overview" | "profile" | "journey" | "account";

const SECTION_ITEMS: Array<{ key: ProfileSectionKey; label: string; hint: string }> = [
  { key: "overview", label: "总览", hint: "At a glance" },
  { key: "profile", label: "资料", hint: "Profile data" },
  { key: "journey", label: "足迹", hint: "My journey" },
  { key: "account", label: "账号", hint: "Account" },
];

const FIELD_GROUPS: Array<{
  title: string;
  description: string;
  fields: Array<{
    key: keyof ProfileFormValues;
    label: string;
    type?: "text" | "email" | "tel" | "textarea" | "select";
    options?: Array<{ label: string; value: string }>;
  }>;
}> = [
  {
    title: "身份资料",
    description: "这部分会影响成员绑定与报名足迹整理。",
    fields: [
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
  ensureDesignTokens();

  const navigate = useNavigate();
  const { user, isAuthenticated, loadingUser, refreshUser, logout, openLogin, isMobile } = useUserState();
  const profileUser = (user as ProfileUser | null) ?? null;

  const [activeSection, setActiveSection] = useState<ProfileSectionKey>("overview");
  const [formValues, setFormValues] = useState<ProfileFormValues>(emptyFormValues);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [membershipActionBusy, setMembershipActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [footprints, setFootprints] = useState<ProfileFootprintPayload>(emptyFootprintPayload);
  const [footprintsLoading, setFootprintsLoading] = useState(false);
  const [footprintsError, setFootprintsError] = useState<string | null>(null);
  const [appReleases, setAppReleases] = useState<AppRelease[]>([]);
  const [appReleasesLoading, setAppReleasesLoading] = useState(false);
  const appReleasesFetched = useRef(false);

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
    if (activeSection !== "account" || appReleasesFetched.current) return;
    appReleasesFetched.current = true;
    setAppReleasesLoading(true);
    fetchAppReleases()
      .then(setAppReleases)
      .catch(() => setAppReleases([]))
      .finally(() => setAppReleasesLoading(false));
  }, [activeSection]);

  const avatarSrc = useMemo(() => {
    if (!profileUser?.username) {
      return `${API_BASE}/static/images/logo/logo.png`;
    }
    return `${API_BASE}/api/user_control/get_profile_image/${profileUser.username}?t=${avatarVersion}`;
  }, [avatarVersion, profileUser?.username]);

  const footprintSummary = footprints.summary ?? emptyFootprintSummary();
  const registrations = footprints.registrations ?? [];
  const youthItems = footprints.youth_class_registrations ?? [];
  const filledFieldCount = Object.values(formValues).filter((value) => String(value || "").trim()).length;
  const totalFieldCount = FIELD_GROUPS.reduce((total, group) => total + group.fields.length, 0);
  const latestFootprint = pickLatestFootprint(registrations, youthItems);
  const nextMembershipExpiry = profileUser?.member_renewals?.[0]?.renewal_date ?? null;
  const hasBoundNric = Boolean(profileUser?.NRIC);

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
              onClick={() => navigate("/")}
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
      await loadFootprints();
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
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "退出失败");
    }
  }

  function updateField<Key extends keyof ProfileFormValues>(key: Key, value: ProfileFormValues[Key]) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleMembershipAction() {
    setError(null);

    if (!profileUser?.is_member) {
      if (!hasBoundNric) {
        setActiveSection("profile");
        setError("请先在资料页填写并保存 NRIC，再继续会员升级申请。");
        return;
      }
      window.open(`${window.location.origin}/template/membership-application`, "_blank", "noopener,noreferrer");
      return;
    }

    if (!hasBoundNric) {
      setActiveSection("profile");
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

  return (
    <div style={pageShellStyle}>
      <section style={heroShellStyle(isMobile)}>
        <div style={heroContentStyle}>
          <div style={heroHeaderRowStyle(isMobile)}>
            <div style={heroIdentityWrapStyle}>
              <div style={eyebrowStyle}>Profile Console</div>
              <h1 style={heroTitleStyle(isMobile)}>{profileUser.display_name || profileUser.username}</h1>
              <p style={heroBodyStyle}>
                把资料、报名足迹和账号操作整合到同一页。你可以在这里维护自己的身份资料，也可以快速回看这张
                `NRIC` 参与过的活动与课程。
              </p>
            </div>
            <div style={heroAvatarPanelStyle(isMobile)}>
              <div style={avatarFrameStyle}>
                <CachedImage
                  src={avatarSrc}
                  cacheKey={`profile-avatar:${profileUser.username}`}
                  refreshKey={avatarVersion}
                  alt={profileUser.username}
                  style={avatarStyle(isMobile)}
                />
              </div>
              <label style={avatarUploadLabelStyle(isMobile)}>
                <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: "none" }} />
                {uploading ? "Uploading…" : "更新头像"}
              </label>
            </div>
          </div>

          <div style={heroMetricsGridStyle(isMobile)}>
            <HeroMetric
              label="资料完整度"
              value={`${filledFieldCount}/${totalFieldCount}`}
              hint="已填写字段"
            />
            <HeroMetric label="绑定 NRIC" value={profileUser.NRIC || "未绑定"} hint="成员资料识别" />
            <HeroMetric label="足迹总数" value={String(footprintSummary.total_count ?? 0)} hint="活动与课程" />
            <HeroMetric label="付款记录" value={String(footprintSummary.payment_count ?? 0)} hint="已提交付款" />
          </div>
        </div>
      </section>

      <section style={sectionNavWrapStyle}>
        <div style={sectionNavStyle(isMobile)}>
          {SECTION_ITEMS.map((item) => {
            const active = activeSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                style={sectionNavButtonStyle(active)}
                onClick={() => setActiveSection(item.key)}
              >
                <span style={sectionNavLabelStyle}>{item.label}</span>
                <span style={sectionNavHintStyle(active)}>{item.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {message ? <div style={successBannerStyle}>{message}</div> : null}
      {error ? <div style={errorBannerStyle}>{error}</div> : null}

      {activeSection === "overview" ? (
        <section style={sectionPanelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelEyebrowStyle}>Overview</div>
              <h2 style={panelTitleStyle}>总览</h2>
            </div>
          </div>
          <div style={overviewGridStyle(isMobile)}>
            <article style={featureCardStyle}>
              <div style={featureCardEyebrowStyle}>Identity</div>
              <h3 style={featureCardTitleStyle}>成员绑定状态</h3>
              <div style={featureListStyle}>
                <InfoRow label="显示名称" value={profileUser.display_name || profileUser.username} />
                <InfoRow label="姓名" value={profileUser.name_NRIC || "未填写"} />
                <InfoRow label="NRIC" value={profileUser.NRIC || "未绑定"} />
                <InfoRow label="成员档案" value={footprints.member?.display_name || "尚未生成"} />
              </div>
              <div style={featureCardFooterStyle}>
                <button type="button" style={softPrimaryButtonStyle} onClick={() => setActiveSection("profile")}>
                  前往编辑资料
                </button>
              </div>
            </article>

            <article style={featureCardStyle}>
              <div style={featureCardEyebrowStyle}>Journey</div>
              <h3 style={featureCardTitleStyle}>最近足迹</h3>
              {latestFootprint ? (
                <div style={latestFootprintStyle}>
                  <span style={journeyKindChipStyle}>{latestFootprint.kind}</span>
                  <div style={latestFootprintTitleStyle}>{latestFootprint.title}</div>
                  <div style={latestFootprintMetaStyle}>{latestFootprint.meta}</div>
                </div>
              ) : (
                <div style={emptyInlineStyle}>还没有查到报名记录。</div>
              )}
              <div style={featureCardFooterStyle}>
                <button type="button" style={ghostButtonStyle} onClick={() => setActiveSection("journey")}>
                  查看完整足迹
                </button>
              </div>
            </article>

            <article style={featureCardStyle}>
              <div style={featureCardEyebrowStyle}>Profile Health</div>
              <h3 style={featureCardTitleStyle}>资料完整度提示</h3>
              <div style={featureChecklistStyle}>
                {FIELD_GROUPS.flatMap((group) =>
                  group.fields.map((field) => {
                    const filled = Boolean(String(formValues[field.key] || "").trim());
                    return (
                      <div key={field.key} style={checkItemStyle(filled)}>
                        <span>{field.label}</span>
                        <strong>{filled ? "已填写" : "待补充"}</strong>
                      </div>
                    );
                  }),
                )}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeSection === "profile" ? (
        <section style={sectionPanelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelEyebrowStyle}>Profile Data</div>
              <h2 style={panelTitleStyle}>资料维护</h2>
            </div>
            <div style={panelHeaderHintStyle}>修改 `NRIC` 后，足迹会按新的成员绑定自动刷新。</div>
          </div>

          <form style={profileFormStackStyle} onSubmit={handleSubmit}>
            {FIELD_GROUPS.map((group) => (
              <section key={group.title} style={groupCardStyle}>
                <div style={groupHeaderStyle}>
                  <div>
                    <div style={groupTitleStyle}>{group.title}</div>
                    <div style={groupDescStyle}>{group.description}</div>
                  </div>
                </div>
                <div style={groupFieldGridStyle(isMobile)}>
                  {group.fields.map((field) => (
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
                </div>
              </section>
            ))}

            <div style={formActionsStyle(isMobile)}>
              <button
                type="button"
                style={ghostButtonStyle}
                onClick={() => setFormValues(formValuesFromUser(profileUser))}
              >
                重置
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={saving}>
                {saving ? "保存中…" : "保存资料"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {activeSection === "journey" ? (
        <section style={sectionPanelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelEyebrowStyle}>My Journey</div>
              <h2 style={panelTitleStyle}>我的足迹</h2>
            </div>
            <div style={journeyHeaderAsideStyle(isMobile)}>
              <span style={nricChipStyle}>{footprints.member?.nric || profileUser.NRIC || "未绑定 NRIC"}</span>
              <span style={journeyHeaderTextStyle}>系统会按当前账号绑定的成员资料整理参加过什么。</span>
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

              {registrations.length ? (
                <div style={footprintSectionStyle}>
                  <div style={sectionSubtitleStyle}>活动报名</div>
                  <div style={footprintListStyle}>
                    {registrations.map((item) => (
                      <FormFootprintCard key={`form-${item.id}`} item={item} />
                    ))}
                  </div>
                </div>
              ) : null}

              {youthItems.length ? (
                <div style={footprintSectionStyle}>
                  <div style={sectionSubtitleStyle}>青少年 & 青年佛学班</div>
                  <div style={footprintListStyle}>
                    {youthItems.map((item) => (
                      <YouthFootprintCard key={`youth-${item.id}`} item={item} />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {activeSection === "account" ? (
        <section style={sectionPanelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelEyebrowStyle}>Account Center</div>
              <h2 style={panelTitleStyle}>账号设置</h2>
            </div>
          </div>

          <div style={accountGridStyle(isMobile)}>
            <article style={featureCardStyle}>
              <div style={featureCardEyebrowStyle}>Session</div>
              <h3 style={featureCardTitleStyle}>当前状态</h3>
              <div style={featureListStyle}>
                <InfoRow label="Username" value={profileUser.username} />
                <InfoRow label="Email" value={profileUser.email || "未填写"} />
                <InfoRow label="Phone" value={profileUser.phone || "未填写"} />
                <InfoRow label="Guardian" value={profileUser.parent_1 || "未填写"} />
              </div>
            </article>

            <article style={featureCardStyle}>
              <div style={featureCardEyebrowStyle}>Actions</div>
              <h3 style={featureCardTitleStyle}>账号操作</h3>
              <MembershipActionCard
                isMember={Boolean(profileUser.is_member)}
                hasBoundNric={hasBoundNric}
                nextExpiryDate={nextMembershipExpiry}
                actionBusy={membershipActionBusy}
                onAction={() => void handleMembershipAction()}
              />
              <div style={accountActionListStyle}>
                <button
                  type="button"
                  style={ghostButtonStyle}
                  onClick={() => {
                    void refreshUser();
                    void loadFootprints();
                  }}
                >
                  刷新用户状态
                </button>
                <button type="button" style={dangerButtonStyle} onClick={() => void handleLogout()}>
                  退出登录
                </button>
              </div>
              <div style={footprintNoteStyle}>
                头像上传仍然保留在页首；这里保留纯账号操作，避免功能混在同一个区域里。
              </div>
            </article>

            <AppDownloadCard releases={appReleases} loading={appReleasesLoading} />
          </div>
        </section>
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

function HeroMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={heroMetricCardStyle}>
      <div style={heroMetricLabelStyle}>{label}</div>
      <div style={heroMetricValueStyle}>{value}</div>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoRowStyle}>
      <span style={infoRowLabelStyle}>{label}</span>
      <span style={infoRowValueStyle}>{value}</span>
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

function AppDownloadCard({ releases, loading }: { releases: AppRelease[]; loading: boolean }) {
  return (
    <article style={featureCardStyle}>
      <div style={featureCardEyebrowStyle}>App Download</div>
      <h3 style={featureCardTitleStyle}>下载 App</h3>
      {loading ? (
        <div style={footprintNoteStyle}>正在加载版本列表…</div>
      ) : releases.length === 0 ? (
        <div style={footprintNoteStyle}>暂无可下载的 App 版本。</div>
      ) : (
        <div style={apkListStyle}>
          {releases.map((r) => (
            <div key={r.filename} style={apkRowStyle}>
              <div style={apkInfoStyle}>
                <span style={apkNameStyle}>{r.filename}</span>
                <span style={apkSizeStyle}>{r.size_label}</span>
              </div>
              <a href={r.download_url} download={r.filename} style={apkDownloadButtonStyle}>
                下载
              </a>
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

const apkRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(15,118,110,0.06)",
  border: "1px solid rgba(15,118,110,0.12)",
};

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

const apkDownloadButtonStyle: CSSProperties = {
  flexShrink: 0,
  padding: "8px 16px",
  borderRadius: "999px",
  background: "linear-gradient(135deg, #0f766e, #1d4ed8)",
  color: "white",
  fontWeight: 700,
  fontSize: "13px",
  textDecoration: "none",
};

const pageShellStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  padding: "28px clamp(18px, 4vw, 40px) 48px",
  overflowX: "hidden",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.18), transparent 32%), linear-gradient(180deg, #eef5f4, #e5edf4 42%, #f6f8fb)",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
  display: "grid",
  gap: "20px",
};

function heroShellStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "18px" : "26px",
    borderRadius: "28px",
    background:
      "linear-gradient(145deg, rgba(11,31,38,0.96), rgba(19,78,74,0.94) 58%, rgba(221,107,32,0.88) 120%)",
    boxShadow: "0 28px 70px rgba(15,23,42,0.16)",
    color: "white",
  };
}

const heroContentStyle: CSSProperties = {
  display: "grid",
  gap: "20px",
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
    fontSize: isMobile ? "clamp(30px, 10vw, 42px)" : "clamp(42px, 5vw, 56px)",
    lineHeight: 0.95,
    letterSpacing: "-0.03em",
  };
}

const heroBodyStyle: CSSProperties = {
  margin: 0,
  maxWidth: "62ch",
  lineHeight: 1.75,
  opacity: 0.88,
  fontSize: "15px",
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
  padding: "10px",
  borderRadius: "28px",
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.16)",
  backdropFilter: "blur(12px)",
};

function avatarStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "112px" : "144px",
    height: isMobile ? "112px" : "144px",
    borderRadius: "26px",
    objectFit: "cover",
    boxShadow: "0 18px 38px rgba(0,0,0,0.24)",
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
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
    gap: "14px",
  };
}

const heroMetricCardStyle: CSSProperties = {
  padding: "16px 18px",
  borderRadius: "20px",
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.16)",
};

const heroMetricLabelStyle: CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  opacity: 0.72,
};

const heroMetricValueStyle: CSSProperties = {
  marginTop: "10px",
  fontSize: "22px",
  fontWeight: 800,
  lineHeight: 1,
};

const heroMetricHintStyle: CSSProperties = {
  marginTop: "8px",
  fontSize: "13px",
  opacity: 0.76,
};

const sectionNavWrapStyle: CSSProperties = {
  position: "sticky",
  top: "10px",
  zIndex: 10,
};

function sectionNavStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
    gap: "10px",
    padding: "10px",
    borderRadius: "22px",
    background: "rgba(255,255,255,0.78)",
    border: "1px solid rgba(216,223,235,0.85)",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    backdropFilter: "blur(18px)",
  };
}

function sectionNavButtonStyle(active: boolean): CSSProperties {
  return {
    border: "none",
    borderRadius: "16px",
    padding: "14px 16px",
    cursor: "pointer",
    display: "grid",
    gap: "4px",
    textAlign: "left",
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

const sectionPanelStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  overflow: "hidden",
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(216,223,235,0.9)",
  boxShadow: "0 24px 50px rgba(15,23,42,0.08)",
  display: "grid",
  gap: "20px",
};

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
  margin: "8px 0 0",
  fontSize: "30px",
  lineHeight: 1.05,
  color: "var(--x-color-ink)",
};

const panelHeaderHintStyle: CSSProperties = {
  maxWidth: "34ch",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
  fontSize: "14px",
};

function overviewGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
    gap: "16px",
  };
}

const featureCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "22px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,248,251,0.98))",
  border: "1px solid rgba(216,223,235,0.9)",
  display: "grid",
  gap: "14px",
};

const featureCardEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const featureCardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "22px",
  lineHeight: 1.15,
};

const featureListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const featureCardFooterStyle: CSSProperties = {
  marginTop: "auto",
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const latestFootprintStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const latestFootprintTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  lineHeight: 1.3,
};

const latestFootprintMetaStyle: CSSProperties = {
  fontSize: "14px",
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
  gap: "10px",
};

function checkItemStyle(filled: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 14px",
    borderRadius: "14px",
    background: filled ? "rgba(15,118,110,0.06)" : "rgba(148,163,184,0.08)",
    color: "var(--x-color-ink)",
  };
}

const infoRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: "1px solid rgba(216,223,235,0.65)",
};

const infoRowLabelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "14px",
};

const infoRowValueStyle: CSSProperties = {
  fontWeight: 700,
  textAlign: "right",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const profileFormStackStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const groupCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "22px",
  background: "linear-gradient(180deg, rgba(250,251,253,0.98), rgba(244,248,250,0.98))",
  border: "1px solid rgba(216,223,235,0.9)",
  display: "grid",
  gap: "14px",
};

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

function formActionsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: isMobile ? "stretch" : "flex-end",
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

const journeyHeaderTextStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  textAlign: "right",
};

const nricChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 14px",
  borderRadius: "999px",
  background: "rgba(15,118,110,0.1)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  border: "1px solid rgba(15,118,110,0.12)",
};

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
