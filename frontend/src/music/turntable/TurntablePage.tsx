import { useState } from "react";
import type { CSSProperties } from "react";

import { useBaseNavbarVisibility } from "../../router/AppChromeContext";
import { QuizHostPage } from "./quiz/QuizHostPage";
import { TurntableSpinnerPage } from "./spinner/TurntableSpinnerPage";

type ActivityMode = "quiz" | "turntable";

const ACTIVITY_ITEMS: Array<{
  key: ActivityMode;
  title: string;
  icon: string;
}> = [
  {
    key: "quiz",
    title: "抢答活动",
    icon: "fas fa-bolt",
  },
  {
    key: "turntable",
    title: "转盘活动",
    icon: "fas fa-record-vinyl",
  },
];

export function TurntablePage() {
  const [activeMode, setActiveMode] = useState<ActivityMode | null>(null);
  const detailActive = activeMode !== null;

  useBaseNavbarVisibility(!detailActive);

  if (detailActive) {
    if (activeMode === "quiz") {
      return <QuizHostPage onBack={() => setActiveMode(null)} />;
    }

    return <TurntableSpinnerPage onBack={() => setActiveMode(null)} />;
  }

  return (
    <main aria-label="转盘" style={pageStyle(false)}>
      <div style={menuShellStyle}>
        {ACTIVITY_ITEMS.map((item) => (
          <button key={item.key} type="button" onClick={() => setActiveMode(item.key)} style={activityButtonStyle}>
            <i className={item.icon} aria-hidden="true" style={activityIconStyle} />
            <span>{item.title}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

function pageStyle(fullscreen: boolean): CSSProperties {
  return {
    minHeight: fullscreen ? "100vh" : "calc(100vh - 60px)",
    background: "var(--x-color-canvas)",
  };
}

const menuShellStyle: CSSProperties = {
  width: "min(760px, calc(100% - 32px))",
  minHeight: "calc(100vh - 60px)",
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  alignContent: "center",
  gap: "18px",
  padding: "32px 0",
};

const activityButtonStyle: CSSProperties = {
  minHeight: "180px",
  display: "grid",
  placeItems: "center",
  gap: "16px",
  padding: "24px",
  border: "1px solid var(--x-color-border)",
  borderRadius: "8px",
  background: "var(--x-color-surface)",
  color: "var(--x-color-ink)",
  boxShadow: "0 18px 40px var(--x-color-shadow-soft)",
  fontSize: "24px",
  fontWeight: 800,
  cursor: "pointer",
};

const activityIconStyle: CSSProperties = {
  fontSize: "42px",
  color: "var(--x-color-accent)",
};
