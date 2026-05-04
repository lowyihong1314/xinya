import { useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../../app/UserState";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { MembershipRegistrationPage } from "./MembershipRegistrationPage";
import { YouthClassRegistrationPage } from "./YouthClassRegistrationPage";

type RegistrationSectionKey = "membership" | "youth_class";

const SECTION_ITEMS: Array<{
  key: RegistrationSectionKey;
  label: string;
  hint: string;
}> = [
  { key: "membership", label: "会员", hint: "升级 / 续费 / 年费审核" },
  { key: "youth_class", label: "青少年佛学班", hint: "13-17 岁常年开放课程报名与收费" },
];

function resolveSectionKey(value: string | null): RegistrationSectionKey {
  return value === "youth_class" ? "youth_class" : "membership";
}

export function LongOpenRegistrationFormPage() {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
  const [activeSection, setActiveSection] = useState<RegistrationSectionKey>(() => resolveSectionKey(null));

  function switchSection(section: RegistrationSectionKey) {
    setActiveSection(section);
  }

  return (
    <div style={pageStyle(isMobile)}>
      <section style={heroStyle(isMobile)}>
        <div style={eyebrowStyle}>CRM / 长期活动表格</div>
        <h1 style={titleStyle(isMobile)}>长期活动表格</h1>
        <p style={descStyle(isMobile)}>
          把持续开放的报名入口集中在一起管理。公开入口现在只有一个，系统会按年龄把 13-17 岁分到青少年佛学班，把 18 岁以上分到会员报名。
        </p>
      </section>

      <section style={sectionNavWrapStyle(isMobile)}>
        <div style={sectionNavStyle(isMobile)}>
          {SECTION_ITEMS.map((item) => {
            const active = activeSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                style={sectionNavButtonStyle(active, isMobile)}
                onClick={() => switchSection(item.key)}
              >
                <span style={sectionNavLabelStyle(isMobile)}>{item.label}</span>
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

function pageStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "14px" : "18px",
    width: "100%",
  };
}

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "18px 16px" : "22px 24px",
    borderRadius: isMobile ? "20px" : "24px",
    background:
      "linear-gradient(145deg, rgba(11,31,38,0.96), rgba(19,78,74,0.94) 58%, rgba(221,107,32,0.88) 120%)",
    boxShadow: "0 22px 54px rgba(15,23,42,0.14)",
    color: "white",
  };
}

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  opacity: 0.78,
};

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: "10px 0 12px",
    fontSize: isMobile ? "27px" : "34px",
    lineHeight: 1.08,
  };
}

function descStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    maxWidth: "70ch",
    lineHeight: isMobile ? 1.6 : 1.75,
    opacity: 0.9,
    fontSize: isMobile ? "13px" : "14px",
  };
}

function sectionNavWrapStyle(isMobile: boolean): CSSProperties {
  return {
    position: isMobile ? "static" : "sticky",
    top: isMobile ? undefined : "10px",
    zIndex: 6,
  };
}

function sectionNavStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: isMobile ? "8px" : "10px",
    padding: isMobile ? "8px" : "10px",
    borderRadius: isMobile ? "18px" : "22px",
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(216,223,235,0.85)",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    backdropFilter: "blur(18px)",
  };
}

function sectionNavButtonStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    border: "none",
    borderRadius: isMobile ? "14px" : "16px",
    padding: isMobile ? "12px 14px" : "14px 16px",
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

function sectionNavLabelStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: isMobile ? "14px" : "15px",
    fontWeight: 800,
  };
}

function sectionNavHintStyle(active: boolean): CSSProperties {
  return {
    fontSize: "12px",
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
  };
}

const contentStyle: CSSProperties = {
  display: "grid",
};
