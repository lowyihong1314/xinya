import { useMemo } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

import { ensureDesignTokens } from "../../../theme/designTokens";
import { MembershipRegistrationPage } from "../../membership/react/MembershipRegistrationPage";
import { YouthClassRegistrationPage } from "../../youth_class/react/YouthClassRegistrationPage";

type RegistrationSectionKey = "membership" | "youth_class";

const SECTION_ITEMS: Array<{
  key: RegistrationSectionKey;
  label: string;
  hint: string;
}> = [
  { key: "membership", label: "会员", hint: "升级 / 续费 / 年费审核" },
  { key: "youth_class", label: "青少年 & 青年佛学班", hint: "常年开放课程报名与收费" },
];

function resolveSectionKey(value: string | null): RegistrationSectionKey {
  return value === "youth_class" ? "youth_class" : "membership";
}

export function PermanentRegistrationPage() {
  ensureDesignTokens();

  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection = useMemo(
    () => resolveSectionKey(searchParams.get("registration")),
    [searchParams],
  );

  function switchSection(section: RegistrationSectionKey) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("crm", "permanent_registration");
    nextParams.set("registration", section);
    setSearchParams(nextParams);
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div style={eyebrowStyle}>CRM / 长期开放表格</div>
        <h1 style={titleStyle}>长期开放表格</h1>
        <p style={descStyle}>
          把持续开放的报名入口集中在一起管理。这里目前收拢了会员升级 / 续费，以及青少年 & 青年佛学班两条长期流程。
        </p>
      </section>

      <section style={sectionNavWrapStyle}>
        <div style={sectionNavStyle}>
          {SECTION_ITEMS.map((item) => {
            const active = activeSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                style={sectionNavButtonStyle(active)}
                onClick={() => switchSection(item.key)}
              >
                <span style={sectionNavLabelStyle}>{item.label}</span>
                <span style={sectionNavHintStyle(active)}>{item.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section style={contentStyle}>
        {activeSection === "membership" ? <MembershipRegistrationPage /> : null}
        {activeSection === "youth_class" ? <YouthClassRegistrationPage /> : null}
      </section>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const heroStyle: CSSProperties = {
  padding: "22px 24px",
  borderRadius: "24px",
  background:
    "linear-gradient(145deg, rgba(11,31,38,0.96), rgba(19,78,74,0.94) 58%, rgba(221,107,32,0.88) 120%)",
  boxShadow: "0 22px 54px rgba(15,23,42,0.14)",
  color: "white",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.78,
};

const titleStyle: CSSProperties = {
  margin: "10px 0 12px",
  fontSize: "34px",
  lineHeight: 1.05,
};

const descStyle: CSSProperties = {
  margin: 0,
  maxWidth: "70ch",
  lineHeight: 1.75,
  opacity: 0.9,
  fontSize: "14px",
};

const sectionNavWrapStyle: CSSProperties = {
  position: "sticky",
  top: "10px",
  zIndex: 6,
};

const sectionNavStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
  padding: "10px",
  borderRadius: "22px",
  background: "rgba(255,255,255,0.82)",
  border: "1px solid rgba(216,223,235,0.85)",
  boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  backdropFilter: "blur(18px)",
};

function sectionNavButtonStyle(active: boolean): CSSProperties {
  return {
    border: "none",
    borderRadius: "16px",
    padding: "14px 16px",
    cursor: "pointer",
    display: "grid",
    gap: "5px",
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

const contentStyle: CSSProperties = {
  display: "grid",
};
