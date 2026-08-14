import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { API_BASE } from "../../../js/apiBase";
import { LogoQrBadge } from "../../../components/LogoQrBadge";
import { GoogleMapEmbed } from "../../../components/GoogleMapEmbed";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { completeParental, registerPerson } from "./api";
import { calcAgeFromIc } from "./nric";
import { collectParentalConsent } from "./parentalBridge";
import { computeEventFlowSlots, slotsToPayload, type FlowSlot } from "./slots";
import { clearDraft, loadDraft, pendingConsentPeople, saveDraft, type DraftPerson, type RegisterDraft } from "./storage";
import { emptyPerson, type Person, type PublicExtraFieldConfig, type PublicForm } from "./types";

type Step = "detail" | "choose" | "form" | "consent" | "done";
type ConsentItem = {
  nric: string;
  name: string;
  name_cn: string;
  phone: string;
  done: boolean;
  parent_1?: string;
  parent_1_phone?: string;
  // 家长英文名 / NRIC：报名时没收集，填完第一张同意书后回填到其余空白的同意书。
  parent_en?: string;
  parent_nric?: string;
};

declare global {
  interface Window {
    form_data?: PublicForm;
  }
}

// 年龄口径：手填的优先（可改），没填就回退 IC 推算；两者都没有就是 null。
function resolveAge(person: Pick<Person, "age" | "nric">): number | null {
  const typed = String(person.age ?? "").trim();
  if (typed !== "") {
    const n = Number(typed);
    return Number.isFinite(n) ? n : null;
  }
  return calcAgeFromIc(person.nric);
}

function fieldOn(form: PublicForm, key: keyof PublicForm): boolean {
  const sw = form.field_switches;
  if (sw && key in sw) return Boolean(sw[key as string]);
  return Boolean(form[key]);
}

function normalizeOptions(raw?: string[] | string | null): string[] {
  if (Array.isArray(raw)) return raw.map((r) => String(r).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw.replace(/\r/g, "\n").replace(/,/g, "\n").split("\n").map((r) => r.trim()).filter(Boolean);
  }
  return [];
}

function buildExtraPayload(values: Record<string, unknown>, configs?: PublicExtraFieldConfig[]) {
  return (configs || [])
    .map((cfg) => {
      const val = values[`field_${cfg.id}`];
      if (val === undefined) return null;
      return { field_config_id: cfg.id, field_value: val };
    })
    .filter(Boolean);
}

function posterUrl(formId: number): string {
  const path = `/api/form/event_poster/${formId}/cache`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

// 多人报名：新家人默认沿用上一位填的紧急联络人（一家人通常相同），仍可逐位手动修改。
function personWithInheritedContact(prev?: Person): Person {
  const base = emptyPerson();
  if (!prev) return base;
  return {
    ...base,
    address: prev.address,
    parent_1: prev.parent_1,
    parent_1_phone: prev.parent_1_phone,
    parent_2: prev.parent_2,
    parent_2_phone: prev.parent_2_phone,
  };
}

export function RegisterPage({ formId }: { formId: number }) {
  useEnsureDesignTokens();
  const form = (typeof window !== "undefined" && window.form_data) || ({ id: formId } as PublicForm);

  const [step, setStep] = useState<Step>("detail");
  const [path, setPath] = useState<"single" | "family">("single");
  const [people, setPeople] = useState<Person[]>([emptyPerson()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [consentQueue, setConsentQueue] = useState<ConsentItem[]>([]);
  const [resumePending, setResumePending] = useState<DraftPerson[]>([]);

  const closed = Boolean(form.registration_closed);
  const firstEvent = form.events?.[0];
  const flowSlots = useMemo(() => computeEventFlowSlots(firstEvent), [firstEvent]);
  // 默认全选所有时段；新报名者一律带上全部时段（弹性模式下可再取消）。
  const defaultSlots = useMemo(() => slotsToPayload(flowSlots), [flowSlots]);
  const makePerson = (prev?: Person): Person => ({ ...personWithInheritedContact(prev), slots: defaultSlots });

  useEffect(() => {
    setResumePending(pendingConsentPeople(loadDraft(formId)));
  }, [formId]);

  // flowSlots 加载好后，给还没有时段的报名者补上「全选」默认值（只在首次加载补，不覆盖用户改动）。
  useEffect(() => {
    if (!flowSlots.length) return;
    setPeople((cur) => cur.map((p) => (p.slots && p.slots.length ? p : { ...p, slots: defaultSlots })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowSlots]);

  function updatePerson(index: number, patch: Partial<Person>) {
    setPeople((cur) => cur.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    setError("");
  }

  function validatePerson(p: Person): string | null {
    if (!p.name_cn.trim()) return "请填写中文名 / Please enter your Chinese name";
    if (!/^[A-Z ]+$/.test(p.name.trim())) return "请填写 IC 英文名（大写字母）/ Please enter your name as per IC (capital letters)";
    if (String(p.nric).replace(/\D/g, "").length < 6) return "请填写正确的 IC 号码 / Please enter a valid IC number";
    if (!p.phone.trim()) return "请填写手机号码 / Please enter your phone number";
    if (!p.gender) return "请选择性别 / Please select gender";
    if (String(p.age).trim() !== "") {
      const typedAge = Number(p.age);
      if (!Number.isInteger(typedAge) || typedAge < 0 || typedAge > 120) {
        return "年龄请填 0–120 的整数 / Age must be a whole number between 0 and 120";
      }
    }
    if (fieldOn(form, "parent_1") && (!p.parent_1.trim() || !p.parent_1_phone.trim())) {
      return "请填写紧急联络人1的称呼与电话 / Please fill in emergency contact 1 name and phone";
    }
    return null;
  }

  function personPayload(p: Person) {
    const age = resolveAge(p);
    const needConsent = Boolean(form.parental_form) && age != null && age < 19;
    return {
      force: Boolean(form.force),
      name: p.name.trim(),
      name_cn: p.name_cn.trim(),
      nric: p.nric.replace(/\D/g, ""),
      phone: p.phone.trim(),
      age,
      parental_form_required: needConsent,
      gender: p.gender,
      email: fieldOn(form, "email") ? p.email.trim() : null,
      address: fieldOn(form, "address") ? p.address.trim() : null,
      parent_1: fieldOn(form, "parent_1") ? p.parent_1.trim() : null,
      parent_1_phone: fieldOn(form, "parent_1") ? p.parent_1_phone.trim() : null,
      parent_2: fieldOn(form, "parent_2") ? p.parent_2.trim() : null,
      parent_2_phone: fieldOn(form, "parent_2") ? p.parent_2_phone.trim() : null,
      medical: fieldOn(form, "medical") ? p.medical.trim() : null,
      allergy: fieldOn(form, "allergy") ? p.allergy.trim() : null,
      other_remark: fieldOn(form, "other_remark") ? p.other_remark.trim() : null,
      // 弹性模式下用报名者的选择；非弹性则不渲染选择器，直接全选所有时段。
      available_time_slot_json: fieldOn(form, "flexible_time_slot") ? p.slots : defaultSlots,
      extra_fields: buildExtraPayload(p.extraValues, form.extra_field_configs),
    };
  }

  async function handleSubmitBasic() {
    setError("");
    for (const p of people) {
      const err = validatePerson(p);
      if (err) {
        setError(err);
        return;
      }
    }
    setSubmitting(true);
    try {
      const draftPeople: DraftPerson[] = [];
      for (const p of people) {
        const payload = personPayload(p);
        await registerPerson(formId, payload);
        draftPeople.push({
          nric: payload.nric,
          name: payload.name,
          name_cn: payload.name_cn,
          phone: payload.phone,
          needConsent: Boolean(payload.parental_form_required),
          submitted: true,
          consentDone: false,
          parent_1: payload.parent_1 ?? undefined,
          parent_1_phone: payload.parent_1_phone ?? undefined,
        });
      }
      saveDraft(formId, { path, people: draftPeople, updatedAt: Date.now() });

      const queue: ConsentItem[] = draftPeople
        .filter((d) => d.needConsent)
        .map((d) => ({
          nric: d.nric,
          name: d.name,
          name_cn: d.name_cn,
          phone: d.phone,
          parent_1: d.parent_1,
          parent_1_phone: d.parent_1_phone,
          done: false,
        }));
      if (queue.length) {
        setConsentQueue(queue);
        setStep("consent");
      } else {
        clearDraft(formId);
        setStep("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后再试 / Submission failed, please try again later");
    } finally {
      setSubmitting(false);
    }
  }

  function markConsentDone(nric: string, propagate?: { parent_en?: string; parent_nric?: string }) {
    const en = propagate?.parent_en?.trim() || "";
    const nr = propagate?.parent_nric?.trim() || "";

    // 队列：当前这张标记完成；其他「未完成、且该项为空」的补上家长英文名/NRIC（非空跳过）。
    setConsentQueue((cur) =>
      cur.map((c) => {
        if (c.nric === nric) return { ...c, done: true };
        if (c.done) return c;
        return {
          ...c,
          parent_en: c.parent_en || en || undefined,
          parent_nric: c.parent_nric || nr || undefined,
        };
      }),
    );

    // 草稿：同步 consentDone，并把家长英文名/NRIC 回填给其他未完成的人（同设备续填时也预填）。
    const draft = loadDraft(formId);
    if (draft) {
      const next: RegisterDraft = {
        ...draft,
        people: draft.people.map((p) => {
          if (p.nric === nric) return { ...p, consentDone: true };
          if (p.consentDone) return p;
          return {
            ...p,
            parent_en: p.parent_en || en || undefined,
            parent_nric: p.parent_nric || nr || undefined,
          };
        }),
      };
      saveDraft(formId, next);
    }
  }

  async function handleConsent(item: ConsentItem) {
    setError("");
    const person: Person = { ...emptyPerson(), nric: item.nric, name: item.name, name_cn: item.name_cn, phone: item.phone };
    // 家长同意书里家长一般就是紧急联络人：用报名时填的紧急联络人预填家长称呼/电话（仍可改）。
    const prefill: Record<string, unknown> = { child_cn: item.name_cn, child_en: item.name, child_nric: item.nric, child_phone: item.phone };
    if (item.parent_1) prefill.parent_cn = item.parent_1;
    if (item.parent_1_phone) prefill.parent_phone = item.parent_1_phone;
    if (item.parent_en) prefill.parent_en = item.parent_en;
    if (item.parent_nric) prefill.parent_nric = item.parent_nric;
    try {
      const parental = await collectParentalConsent(form, person, prefill);
      if (!parental) return; // 用户取消
      await completeParental(formId, item.nric, parental);
      // 提交后：把这张同意书填的家长英文名/NRIC 回填给其他空白的同意书。
      markConsentDone(item.nric, {
        parent_en: typeof parental.parent_en === "string" ? parental.parent_en : "",
        parent_nric: typeof parental.parent_nric === "string" ? parental.parent_nric : "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "同意书提交失败 / Consent submission failed");
    }
  }

  function resumeConsent() {
    setConsentQueue(
      resumePending.map((d) => ({
        nric: d.nric,
        name: d.name,
        name_cn: d.name_cn,
        phone: d.phone,
        parent_1: d.parent_1,
        parent_1_phone: d.parent_1_phone,
        parent_en: d.parent_en,
        parent_nric: d.parent_nric,
        done: false,
      })),
    );
    setResumePending([]);
    setStep("consent");
  }

  // 当 consent 队列全部完成 → done
  useEffect(() => {
    if (step === "consent" && consentQueue.length && consentQueue.every((c) => c.done)) {
      clearDraft(formId);
      setMessage("全部家长同意书已完成。/ All parental consent forms are complete.");
      setStep("done");
    }
  }, [step, consentQueue, formId]);

  const hasFees = Boolean(form.fees && form.fees.length);
  const currentYearTitle = form.title || "活动报名";

  // 进行单位：只有默认的「主办单位 · 地南佛学会」一条时不特别展示；
  // 有主催/承办/协办/协调或其他主办时按角色分组显示在页头（带 logo）。
  const latestEvent = form.events?.length ? form.events[form.events.length - 1] : null;
  // 顺序完全跟 CRM 基本设置里排的 sort_order 走（后端已排好，这里再兜一次底）。
  const organizingUnits = (latestEvent?.organizing_units || [])
    .filter((u) => (u.unit_name || "").trim())
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0));
  const showUnitsBanner =
    organizingUnits.length > 0 &&
    !(
      organizingUnits.length === 1 &&
      organizingUnits[0].role === "主办单位" &&
      (organizingUnits[0].unit_name || "").trim() === "地南佛学会"
    );
  // 角色分组的先后 = 该角色第一个单位在排序里的位置，所以 CRM 调顺序这里立刻跟着变。
  const unitRoles = Array.from(
    new Set(organizingUnits.map((u) => (u.role || "").trim()).filter(Boolean)),
  );

  return (
    <div style={styles.page}>
      <LogoQrBadge />
      <div style={styles.poster} aria-hidden>
        <div style={{ ...styles.posterImg, backgroundImage: `url(${posterUrl(formId)})` }} />
        <div style={styles.posterOverlay} />
      </div>
      <div style={styles.shell}>
        <header style={styles.head}>
          <p style={styles.eyebrow}>
            活动报名
            <span style={styles.eyebrowEn}>Event Registration</span>
          </p>
          <h1 style={styles.title}>{currentYearTitle}</h1>
          {showUnitsBanner ? (
            <div style={styles.unitsBanner}>
              {unitRoles.map((role) => (
                <div key={role} style={styles.unitsRow}>
                  <span style={styles.unitsRole}>{role}</span>
                  <span style={styles.unitsList}>
                    {organizingUnits
                      .filter((u) => (u.role || "").trim() === role)
                      .map((u, idx) => (
                        <span key={u.id ?? `${role}-${idx}`} style={styles.unitChip}>
                          {u.logo_url ? <img src={u.logo_url} alt="" style={styles.unitLogo} /> : null}
                          <span style={styles.unitChipName}>{u.unit_name}</span>
                        </span>
                      ))}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </header>

        {error ? <div style={styles.errorBox}>{error}</div> : null}
        {message ? <div style={styles.successBox}>{message}</div> : null}

        {resumePending.length && step === "detail" ? (
          <div style={styles.resumeBox}>
            <span>
              你还有 {resumePending.length} 位的家长同意书未完成。
              <span style={styles.noteEn}>{resumePending.length} parental consent form(s) still incomplete.</span>
            </span>
            <button type="button" style={styles.resumeButton} onClick={resumeConsent}>
              继续完成家长同意书
              <span style={styles.btnEn}>Continue Parental Consent</span>
            </button>
          </div>
        ) : null}

        {step === "detail" ? (
          <EventDetail form={form} closed={closed} onNext={() => setStep("choose")} />
        ) : null}

        {step === "choose" ? (
          <section style={styles.card}>
            <BackButton onClick={() => setStep("detail")} />
            <SectionTitle cn="请选择报名方式" en="Choose How to Register" />
            <button
              type="button"
              style={styles.choiceCard}
              onClick={() => {
                setPath("single");
                setPeople([makePerson()]);
                setStep("form");
              }}
            >
              <span style={styles.choiceTitle}>
                个人报名
                <span style={styles.choiceTitleEn}>Individual</span>
              </span>
              <span style={styles.choiceMeta}>为自己/一个人报名</span>
              <span style={styles.choiceMetaEn}>Register yourself or one person</span>
            </button>
            <button
              type="button"
              style={styles.choiceCard}
              onClick={() => {
                setPath("family");
                setPeople([makePerson()]);
                setStep("form");
              }}
            >
              <span style={styles.choiceTitle}>
                多人报名（家庭）
                <span style={styles.choiceTitleEn}>Family / Group</span>
              </span>
              <span style={styles.choiceMeta}>一次为多位家人报名</span>
              <span style={styles.choiceMetaEn}>Register several family members at once</span>
            </button>
          </section>
        ) : null}

        {step === "form" ? (
          <section style={styles.stack}>
            <BackButton onClick={() => setStep("choose")} disabled={submitting} />
            {people.map((person, index) => (
              <PersonForm
                key={index}
                form={form}
                person={person}
                index={index}
                showRemove={path === "family" && people.length > 1}
                flowSlots={flowSlots}
                onChange={(patch) => updatePerson(index, patch)}
                onRemove={() => setPeople((cur) => cur.filter((_, i) => i !== index))}
              />
            ))}
            {path === "family" ? (
              <button type="button" style={styles.addButton} onClick={() => setPeople((cur) => [...cur, makePerson(cur[cur.length - 1])])}>
                + 添加一位家人
                <span style={styles.btnEn}>Add Family Member</span>
              </button>
            ) : null}
            <p style={styles.noteOnPoster}>
              提交后基本资料会先保存；未成年人的家长同意书在下一步完成（可稍后同设备继续）。
              <span style={styles.noteEn}>
                Your details are saved first. Parental consent for minors is completed in the next step (you may continue later on this device).
              </span>
            </p>
            <button
              type="button"
              style={{ ...styles.primaryButton, ...(submitting ? styles.buttonDisabled : {}) }}
              onClick={() => void handleSubmitBasic()}
              disabled={submitting}
            >
              {submitting ? "提交中…" : "提交报名"}
              <span style={styles.btnEn}>{submitting ? "Submitting…" : "Submit Registration"}</span>
            </button>
            <button type="button" style={styles.ghostButton} onClick={() => setStep("choose")} disabled={submitting}>
              ← 返回
              <span style={styles.btnEn}>Back</span>
            </button>
          </section>
        ) : null}

        {step === "consent" ? (
          <section style={styles.stack}>
            <div style={styles.card}>
              <SectionTitle cn="家长同意书" en="Parental Consent" />
              <p style={styles.note}>
                以下未成年人需要家长同意书，请逐位完成（也可稍后同设备继续）。
                <span style={styles.noteEn}>
                  The minors below need parental consent. Please complete them one by one (you may continue later on this device).
                </span>
              </p>
            </div>
            {consentQueue.map((item) => (
              <div key={item.nric} style={styles.consentRow}>
                <div style={styles.consentInfo}>
                  <span style={styles.consentName}>{item.name_cn || item.name || item.nric}</span>
                  <span style={styles.consentMeta}>{item.done ? "已完成 Completed" : "待完成 Pending"}</span>
                </div>
                {item.done ? (
                  <span style={styles.doneChip}>✓ 已完成 Done</span>
                ) : (
                  <button type="button" style={styles.smallPrimary} onClick={() => void handleConsent(item)}>
                    填写同意书
                    <span style={styles.btnEn}>Fill Consent</span>
                  </button>
                )}
              </div>
            ))}
            <button type="button" style={styles.ghostButton} onClick={() => setStep("done")}>
              稍后再填，先完成
              <span style={styles.btnEn}>Finish Now, Fill Later</span>
            </button>
          </section>
        ) : null}

        {step === "done" ? (
          <section style={styles.card}>
            <div style={styles.doneIcon}>✓</div>
            <SectionTitle cn="报名完成" en="Registration Complete" />
            <p style={styles.note}>
              我们已收到你的报名资料。
              <span style={styles.noteEn}>We have received your registration.</span>
            </p>
            {hasFees ? (
              <a href={`/api/form/pay_register/${formId}`} style={styles.primaryLink}>
                前往付款
                <span style={styles.btnEn}>Proceed to Payment</span>
              </a>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function EventDetail({ form, closed, onNext }: { form: PublicForm; closed: boolean; onNext: () => void }) {
  const event = form.events?.[0];
  return (
    <section style={styles.card}>
      {event ? (
        <>
          {event.event_name ? <p style={styles.cardTitle}>{event.event_name}</p> : null}
          <dl style={styles.factList}>
            {event.datetime ? <Fact label="时间" en="Date & Time" value={new Date(event.datetime).toLocaleString()} /> : null}
            {event.location ? <Fact label="地点" en="Venue" value={event.location} /> : null}
            {event.target ? <Fact label="对象" en="Target Audience" value={event.target} /> : null}
            {event.purpose ? <Fact label="目的" en="Purpose" value={event.purpose} /> : null}
          </dl>
          {event.place_id || event.location ? (
            <div style={{ marginTop: 10 }}>
              {event.location_name ? (
                <div style={styles.venueName}>
                  <i className="fa-solid fa-location-dot" aria-hidden="true" style={{ color: "var(--x-color-accent, #0f766e)" }} />
                  {event.location_name}
                </div>
              ) : null}
              <GoogleMapEmbed placeId={event.place_id} lat={event.lat} lng={event.lng} query={event.location} height={200} />
            </div>
          ) : null}
        </>
      ) : null}
      {form.detail ? <div style={styles.detailText}>{form.detail}</div> : null}
      {form.expired ? (
        <p style={styles.note}>
          <span style={styles.noteLabel}>
            报名截止
            <span style={styles.fieldLabelEn}>Registration Deadline</span>
          </span>
          <span style={styles.noteValue}>{form.expired}</span>
        </p>
      ) : null}
      {form.fees && form.fees.length ? (
        <div style={styles.feeBox}>
          <span style={styles.feeTitle}>
            费用
            <span style={styles.fieldLabelEn}>Fees</span>
          </span>
          {form.fees.map((fee, i) => (
            <div key={i} style={styles.feeLine}>
              {fee.category || "费用"}：RM {Number(fee.amount).toFixed(2)}
            </div>
          ))}
        </div>
      ) : null}

      {closed ? (
        <div style={styles.closedBox}>
          报名已截止
          <span style={styles.closedBoxEn}>Registration Closed</span>
        </div>
      ) : (
        <button type="button" style={styles.primaryButton} onClick={onNext}>
          开始报名
          <span style={styles.btnEn}>Start Registration</span>
        </button>
      )}
    </section>
  );
}

function Fact({ label, en, value }: { label: string; en?: string; value: string }) {
  return (
    <div style={styles.factRow}>
      <dt style={styles.factLabel}>
        {label}
        {en ? <span style={styles.fieldLabelEn}>{en}</span> : null}
      </dt>
      <dd style={styles.factValue}>{value}</dd>
    </div>
  );
}

// 中文粗体 + 后缀小号英文的区块标题（各步骤共用）。
function SectionTitle({ cn, en }: { cn: string; en: string }) {
  return (
    <p style={styles.cardTitle}>
      {cn}
      <span style={styles.cardTitleEn}>{en}</span>
    </p>
  );
}

// 步骤顶部的返回按钮（选择报名方式 / 填写资料都用它）。
function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      style={{ ...styles.backButton, ...(disabled ? styles.buttonDisabled : {}) }}
      onClick={onClick}
      disabled={disabled}
    >
      ← 返回
      <span style={styles.backButtonEn}>Back</span>
    </button>
  );
}

function PersonForm({
  form,
  person,
  index,
  showRemove,
  flowSlots,
  onChange,
  onRemove,
}: {
  form: PublicForm;
  person: Person;
  index: number;
  showRemove: boolean;
  flowSlots: FlowSlot[];
  onChange: (patch: Partial<Person>) => void;
  onRemove: () => void;
}) {
  const age = resolveAge(person);
  const needConsent = Boolean(form.parental_form) && age != null && age < 19;
  // 只有开启「弹性参加时段」才渲染时段选择器；否则不显示（提交时默认全选）。
  const slotPickerOn = fieldOn(form, "flexible_time_slot");

  function toggleSlot(slot: FlowSlot, checked: boolean) {
    const cur = flowSlots.filter((s) => person.slots.some((ps) => ps.datetime === s.startISO));
    const nextSelected = checked ? [...cur, slot] : cur.filter((s) => s.startISO !== slot.startISO);
    onChange({ slots: slotsToPayload(nextSelected) });
  }

  return (
    <div style={styles.card}>
      <div style={styles.personHead}>
        <span style={styles.cardTitle}>
          报名人 {index + 1}
          <span style={styles.cardTitleEn}>Participant {index + 1}</span>
        </span>
        {showRemove ? (
          <button type="button" style={styles.removePerson} onClick={onRemove}>
            移除 Remove
          </button>
        ) : null}
      </div>

      <Field label="中文名 *" en="Chinese Name">
        <input style={styles.input} value={person.name_cn} onChange={(e) => onChange({ name_cn: e.target.value })} />
      </Field>
      <Field label="IC 英文名 *" en="Name as per IC">
        <input
          style={styles.input}
          value={person.name}
          placeholder="如 IC 上的英文名 / Name as per IC"
          onChange={(e) => onChange({ name: e.target.value.toUpperCase().replace(/[^A-Z ]/g, "") })}
        />
      </Field>
      <Field label="IC 号码 *" en="IC / NRIC No.">
        <input
          style={styles.input}
          inputMode="numeric"
          value={person.nric}
          onChange={(e) => {
            const nric = e.target.value.replace(/\D/g, "");
            // IC 一变就按新 IC 重算年龄填进去；算不出来（位数不够/日期不合法）就保留原本填的。
            const autoAge = calcAgeFromIc(nric);
            onChange(autoAge != null ? { nric, age: String(autoAge) } : { nric });
          }}
        />
      </Field>
      <div style={styles.ageRow}>
        <span style={styles.ageLabel}>
          年龄
          <span style={styles.fieldLabelEn}>Age</span>
        </span>
        {/* 年龄先锁死只读：由 IC 自动带出。要不要开放手改还在讨论（会牵动报名费年龄档）。 */}
        <input
          style={{ ...styles.ageInput, ...styles.ageInputReadonly }}
          inputMode="numeric"
          readOnly
          title="由 IC 号码自动带出 / Auto-filled from IC"
          placeholder="自动 / auto"
          value={person.age}
          onChange={(e) => onChange({ age: e.target.value.replace(/\D/g, "").slice(0, 3) })}
        />
        <span style={styles.ageUnit}>岁 years</span>
        {needConsent ? <span style={styles.parentalPill}>需家长同意书 Parental Consent</span> : null}
      </div>
      <Field label="手机号码 *" en="Phone No.">
        <input style={styles.input} inputMode="tel" value={person.phone} onChange={(e) => onChange({ phone: e.target.value })} />
      </Field>
      <Field label="性别 *" en="Gender">
        <select style={styles.input} value={person.gender} onChange={(e) => onChange({ gender: e.target.value })}>
          <option value="">请选择 / Select</option>
          <option value="男">男 Male</option>
          <option value="女">女 Female</option>
        </select>
      </Field>

      {fieldOn(form, "email") ? (
        <Field label="电子邮箱" en="Email">
          <input style={styles.input} inputMode="email" value={person.email} onChange={(e) => onChange({ email: e.target.value })} />
        </Field>
      ) : null}
      {fieldOn(form, "parent_1") ? (
        <>
          <Field label="紧急联络人1 称呼 *" en="Emergency Contact 1 Name">
            <input style={styles.input} value={person.parent_1} onChange={(e) => onChange({ parent_1: e.target.value })} />
          </Field>
          <Field label="紧急联络人1 电话 *" en="Emergency Contact 1 Phone">
            <input style={styles.input} inputMode="tel" value={person.parent_1_phone} onChange={(e) => onChange({ parent_1_phone: e.target.value })} />
          </Field>
        </>
      ) : null}
      {fieldOn(form, "parent_2") ? (
        <>
          <Field label="紧急联络人2 称呼" en="Emergency Contact 2 Name">
            <input style={styles.input} value={person.parent_2} onChange={(e) => onChange({ parent_2: e.target.value })} />
          </Field>
          <Field label="紧急联络人2 电话" en="Emergency Contact 2 Phone">
            <input style={styles.input} inputMode="tel" value={person.parent_2_phone} onChange={(e) => onChange({ parent_2_phone: e.target.value })} />
          </Field>
        </>
      ) : null}
      {fieldOn(form, "address") ? (
        <Field label="居住地址" en="Address">
          <input style={styles.input} value={person.address} onChange={(e) => onChange({ address: e.target.value })} />
        </Field>
      ) : null}
      {fieldOn(form, "medical") ? (
        <Field label="医疗备注" en="Medical Notes">
          <input style={styles.input} value={person.medical} onChange={(e) => onChange({ medical: e.target.value })} />
        </Field>
      ) : null}
      {fieldOn(form, "allergy") ? (
        <Field label="过敏" en="Allergies">
          <input style={styles.input} value={person.allergy} onChange={(e) => onChange({ allergy: e.target.value })} />
        </Field>
      ) : null}
      {fieldOn(form, "other_remark") ? (
        <Field label="其他备注" en="Other Remarks">
          <input style={styles.input} value={person.other_remark} onChange={(e) => onChange({ other_remark: e.target.value })} />
        </Field>
      ) : null}

      {(form.extra_field_configs || []).map((cfg) => (
        <ExtraField
          key={cfg.id}
          config={cfg}
          value={person.extraValues[`field_${cfg.id}`]}
          onChange={(val) => onChange({ extraValues: { ...person.extraValues, [`field_${cfg.id}`]: val } })}
        />
      ))}

      {slotPickerOn && flowSlots.length ? (
        <Field label="参加时段" en="Sessions">
          <div style={styles.slotList}>
            {flowSlots.map((slot) => {
              const checked = person.slots.some((ps) => ps.datetime === slot.startISO);
              return (
                <label key={slot.key} style={styles.slotItem}>
                  <input type="checkbox" checked={checked} onChange={(e) => toggleSlot(slot, e.target.checked)} />
                  <span>{slot.label}</span>
                </label>
              );
            })}
          </div>
        </Field>
      ) : null}
    </div>
  );
}

function ExtraField({
  config,
  value,
  onChange,
}: {
  config: PublicExtraFieldConfig;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const type = config.field_type;
  if (type === "checkbox") {
    return (
      <label style={styles.checkboxRow}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span style={styles.fieldLabel}>{config.label}</span>
      </label>
    );
  }
  if (type === "select") {
    const options = normalizeOptions(config.options);
    return (
      <Field label={config.label}>
        <select style={styles.input} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">请选择 / Select</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (type === "textarea") {
    return (
      <Field label={config.label}>
        <textarea style={styles.textarea} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  return (
    <Field label={config.label}>
      <input
        style={styles.input}
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Field({ label, en, children }: { label: string; en?: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>
        {label}
        {en ? <span style={styles.fieldLabelEn}>{en}</span> : null}
      </label>
      {children}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { position: "relative", minHeight: "100vh", width: "100%", fontFamily: "var(--x-font-sans)", color: "var(--x-color-ink)", overflowX: "hidden" },
  poster: { position: "fixed", inset: 0, zIndex: 0 },
  posterImg: { position: "absolute", inset: 0, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(26px) brightness(0.7)", transform: "scale(1.1)" },
  posterOverlay: { position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(18,52,59,0.72), rgba(15,118,110,0.55))" },
  shell: { position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "28px 16px 48px", display: "flex", flexDirection: "column", gap: "14px" },
  head: { textAlign: "center", color: "#fff" },
  eyebrow: { margin: 0, fontSize: "12px", letterSpacing: "2px", fontWeight: 800, opacity: 0.9 },
  eyebrowEn: { marginLeft: "7px", fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.6px", opacity: 0.8 },
  title: { margin: "6px 0 0", fontSize: "22px", fontWeight: 800 },
  unitsBanner: {
    margin: "12px auto 0",
    maxWidth: "560px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "14px",
    background: "rgba(255, 255, 255, 0.12)",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    backdropFilter: "blur(8px)",
    textAlign: "left", // head 是居中的，这块单位横幅自己靠左
  },
  // 角色标签自己一行，单位排它下面（名字里的换行由 unitChipName 的 pre-wrap 保留）
  unitsRow: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "5px", minWidth: 0 },
  unitsRole: { fontSize: "11.5px", fontWeight: 800, letterSpacing: "1px", opacity: 0.85, whiteSpace: "nowrap", flexShrink: 0 },
  unitsList: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-start", minWidth: 0, width: "100%" },
  unitChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px 4px 4px",
    // 名字可能折成两行，用 16px 圆角比胶囊形更耐看（单行时看起来仍接近胶囊）
    borderRadius: "16px",
    background: "rgba(255, 255, 255, 0.92)",
    color: "#134e4a",
    fontSize: "12.5px",
    fontWeight: 700,
    maxWidth: "100%",
    minWidth: 0,
  },
  // 单位名可能是「中文 + 英文全称」很长，甚至在 CRM 里手动打了换行：保留换行 + 自动折行
  unitChipName: { minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.35, textAlign: "left" },
  unitLogo: { width: 24, height: 24, flexShrink: 0, borderRadius: "50%", objectFit: "contain", background: "#fff" },
  venueName: { display: "flex", alignItems: "center", gap: "6px", margin: "0 0 6px", fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-ink)" },
  card: { background: "var(--x-color-panel-strongest)", borderRadius: "var(--x-radius-lg)", boxShadow: "0 20px 50px var(--x-color-shadow)", padding: "18px 18px 20px", display: "flex", flexDirection: "column", gap: "12px" },
  stack: { display: "flex", flexDirection: "column", gap: "14px" },
  cardTitle: { margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--x-color-ink)" },
  // 区块标题后缀的小号英文
  cardTitleEn: { marginLeft: "7px", fontSize: "11.5px", fontWeight: 600, color: "var(--x-color-ink-muted)", letterSpacing: "0.2px" },
  note: { margin: 0, fontSize: "12.5px", lineHeight: 1.5, color: "var(--x-color-ink-muted)" },
  // 直接压在海报背景上的说明（不在白卡里）：深色字看不清，改白字 + 毛玻璃底
  noteOnPoster: { margin: 0, padding: "10px 14px", borderRadius: "var(--x-radius-md)", background: "rgba(0, 0, 0, 0.28)", border: "1px solid rgba(255, 255, 255, 0.22)", backdropFilter: "blur(8px)", fontSize: "12.5px", lineHeight: 1.5, fontWeight: 600, color: "#fff" },
  // 说明文字里的英文：另起一行、更淡，不跟中文抢
  noteEn: { display: "block", marginTop: "2px", fontSize: "11.5px", lineHeight: 1.45, opacity: 0.8 },
  noteLabel: { display: "block", fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-ink)" },
  noteValue: { display: "block", marginTop: "2px", fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink)" },
  field: { display: "flex", flexDirection: "column", gap: "5px" },
  fieldLabel: { fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-ink)" },
  // 中文标签旁的小号英文（不懂中文的报名者也能看懂）
  fieldLabelEn: { marginLeft: "6px", fontSize: "11px", fontWeight: 500, color: "var(--x-color-ink-muted)", letterSpacing: "0.2px" },
  // 按钮里第二行的小号英文（继承按钮颜色，只压低不透明度）
  btnEn: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.3px", opacity: 0.78 },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", fontSize: "15px", borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", outline: "none" },
  textarea: { width: "100%", boxSizing: "border-box", minHeight: "70px", resize: "vertical", padding: "11px 12px", fontSize: "14px", borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)" },
  ageRow: { display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "var(--x-radius-sm)", background: "var(--x-color-panel-alt)" },
  ageLabel: { fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-ink)" },
  ageInput: { width: "112px", flexShrink: 0, boxSizing: "border-box", padding: "8px 10px", fontSize: "15px", fontWeight: 700, borderRadius: "var(--x-radius-sm)", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", outline: "none" },
  ageInputReadonly: { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)", cursor: "default" },
  ageUnit: { fontSize: "12.5px", color: "var(--x-color-ink-muted)" },
  parentalPill: { marginLeft: "auto", fontSize: "12px", fontWeight: 700, color: "var(--x-color-warning)", background: "var(--x-color-warning-soft)", border: "1px solid var(--x-color-warning-border)", borderRadius: "999px", padding: "2px 10px" },
  checkboxRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" },
  slotList: { display: "flex", flexDirection: "column", gap: "6px" },
  slotItem: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", padding: "6px 8px", borderRadius: "8px", background: "var(--x-color-panel-alt)" },
  primaryButton: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", lineHeight: 1.25, padding: "12px 16px", fontSize: "15px", fontWeight: 700, color: "#fff", background: "var(--x-color-accent)", border: "none", borderRadius: "var(--x-radius-sm)", cursor: "pointer" },
  primaryLink: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", lineHeight: 1.25, textAlign: "center", padding: "12px 16px", fontSize: "15px", fontWeight: 700, color: "#fff", background: "var(--x-color-accent)", borderRadius: "var(--x-radius-sm)", textDecoration: "none" },
  buttonDisabled: { opacity: 0.55, cursor: "not-allowed" },
  ghostButton: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", lineHeight: 1.25, padding: "10px 16px", fontSize: "14px", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.16)", border: "none", borderRadius: "var(--x-radius-sm)", cursor: "pointer" },
  addButton: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", lineHeight: 1.25, padding: "11px 12px", fontSize: "14px", fontWeight: 700, color: "var(--x-color-accent-strong)", background: "var(--x-color-panel-strongest)", border: "1px dashed var(--x-color-accent-border)", borderRadius: "var(--x-radius-sm)", cursor: "pointer" },
  choiceCard: { display: "flex", flexDirection: "column", gap: "3px", textAlign: "left", padding: "16px", borderRadius: "var(--x-radius-md)", border: "1px solid var(--x-color-accent-border)", background: "var(--x-color-accent-soft)", cursor: "pointer" },
  choiceTitle: { fontSize: "16px", fontWeight: 800, color: "var(--x-color-accent-strong)" },
  choiceTitleEn: { marginLeft: "7px", fontSize: "11.5px", fontWeight: 600, opacity: 0.75 },
  choiceMeta: { fontSize: "12.5px", fontWeight: 600, color: "var(--x-color-ink)" },
  choiceMetaEn: { fontSize: "11px", color: "var(--x-color-ink-muted)", opacity: 0.9 },
  backButton: { alignSelf: "flex-start", display: "inline-flex", alignItems: "baseline", gap: "6px", padding: "7px 14px", fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-accent-strong)", background: "var(--x-color-accent-soft)", border: "1px solid var(--x-color-accent-border)", borderRadius: "999px", cursor: "pointer" },
  backButtonEn: { fontSize: "11px", fontWeight: 600, color: "var(--x-color-ink-muted)" },
  personHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  removePerson: { padding: "5px 10px", fontSize: "12px", fontWeight: 600, color: "var(--x-color-danger)", background: "var(--x-color-danger-soft)", border: "1px solid var(--x-color-danger-border)", borderRadius: "8px", cursor: "pointer" },
  errorBox: { padding: "10px 14px", borderRadius: "var(--x-radius-sm)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", border: "1px solid var(--x-color-danger-border)", fontSize: "13px" },
  successBox: { padding: "10px 14px", borderRadius: "var(--x-radius-sm)", background: "var(--x-color-success-soft)", color: "var(--x-color-success)", border: "1px solid rgba(21,128,61,0.28)", fontSize: "13px" },
  resumeBox: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px 14px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-warning-soft)", border: "1px solid var(--x-color-warning-border)", color: "var(--x-color-warning)", fontSize: "13px", fontWeight: 600 },
  resumeButton: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", lineHeight: 1.25, padding: "8px 14px", fontSize: "13px", fontWeight: 700, color: "#fff", background: "var(--x-color-accent)", border: "none", borderRadius: "8px", cursor: "pointer" },
  factList: { margin: 0, display: "flex", flexDirection: "column", gap: "12px" },
  factRow: { display: "flex", flexDirection: "column", gap: "2px", margin: 0 },
  factLabel: { margin: 0, fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-ink)" },
  factValue: { margin: 0, fontSize: "13px", color: "var(--x-color-ink)", whiteSpace: "pre-wrap" },
  detailText: { fontSize: "13px", lineHeight: 1.6, color: "var(--x-color-ink)", whiteSpace: "pre-wrap" },
  feeBox: { display: "flex", flexDirection: "column", gap: "4px", padding: "10px 12px", borderRadius: "var(--x-radius-sm)", background: "var(--x-color-panel-alt)" },
  feeTitle: { fontSize: "13.5px", fontWeight: 800, color: "var(--x-color-ink)" },
  feeLine: { fontSize: "13px", color: "var(--x-color-ink)" },
  closedBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "12px", textAlign: "center", borderRadius: "var(--x-radius-sm)", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 800 },
  closedBoxEn: { fontSize: "11px", fontWeight: 600, opacity: 0.8 },
  consentRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "14px 16px", borderRadius: "var(--x-radius-md)", background: "var(--x-color-panel-strongest)", boxShadow: "0 12px 30px var(--x-color-shadow-soft)" },
  consentInfo: { display: "flex", flexDirection: "column", gap: "3px" },
  consentName: { fontSize: "14px", fontWeight: 800, color: "var(--x-color-ink)" },
  consentMeta: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  smallPrimary: { flexShrink: 0, whiteSpace: "nowrap", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px", lineHeight: 1.25, padding: "8px 14px", fontSize: "13px", fontWeight: 700, color: "#fff", background: "var(--x-color-accent)", border: "none", borderRadius: "8px", cursor: "pointer" },
  doneChip: { fontSize: "13px", fontWeight: 700, color: "var(--x-color-success)" },
  doneIcon: { width: 54, height: 54, borderRadius: "50%", alignSelf: "center", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", color: "#fff", background: "var(--x-color-success)" },
};
