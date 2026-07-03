import { useState } from "react";
import type { CSSProperties } from "react";

import { clampSlotCount, defaultSlotName, buildDefaultSlots } from "./turntableRandom";
import { TurntableUserPicker } from "./TurntableUserPicker";
import type { SlotMachineSettings, SlotConfig } from "./types";

export function TurntableSettingsPanel({
  settings,
  onCancel,
  onSave,
}: {
  settings: SlotMachineSettings;
  onCancel: () => void;
  onSave: (settings: SlotMachineSettings) => void;
}) {
  const [draft, setDraft] = useState<SlotMachineSettings>(() => ensureSlots(settings));
  const [activeSlot, setActiveSlot] = useState(0);
  const slotCount = clampSlotCount(draft.slot_count);
  const currentSlot = draft.slots[activeSlot];

  function handleSlotCountChange(count: number) {
    const clamped = clampSlotCount(count);
    setDraft((prev) => {
      const slots = [...prev.slots];
      while (slots.length < clamped) {
        slots.push({ name: defaultSlotName(slots.length), candidates: [] });
      }
      return { ...prev, slot_count: clamped, slots: slots.slice(0, clamped) };
    });
    if (activeSlot >= clamped) setActiveSlot(clamped - 1);
  }

  function handleSlotNameChange(name: string) {
    setDraft((prev) => {
      const slots = [...prev.slots];
      slots[activeSlot] = { ...slots[activeSlot], name };
      return { ...prev, slots };
    });
  }

  function handleSlotCandidatesChange(candidates: SlotConfig["candidates"]) {
    setDraft((prev) => {
      const slots = [...prev.slots];
      slots[activeSlot] = { ...slots[activeSlot], candidates: dedupeUsers(candidates) };
      return { ...prev, slots };
    });
  }

  function handleSave() {
    onSave({
      ...draft,
      slot_count: slotCount,
      slots: draft.slots.slice(0, slotCount),
    });
  }

  return (
    <section style={panelStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Settings</div>
          <h2 style={titleStyle}>乐团配置</h2>
        </div>
        <div style={headerActionsStyle}>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            取消
          </button>
          <button type="button" onClick={handleSave} style={primaryButtonStyle}>
            保存
          </button>
        </div>
      </header>

      <div style={controlsStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>角色数量</span>
          <select
            value={draft.slot_count}
            onChange={(e) => handleSlotCountChange(Number(e.target.value))}
            style={inputStyle}
          >
            {[3, 4, 5, 6].map((v) => (
              <option key={v} value={v}>
                {v} 个角色
              </option>
            ))}
          </select>
        </label>

        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={draft.return_after_drawn}
            onChange={(e) => setDraft((prev) => ({ ...prev, return_after_drawn: e.target.checked }))}
          />
          <span>抽中返回</span>
        </label>

        <label style={toggleStyle}>
          <input
            type="checkbox"
            checked={draft.unique_per_round}
            onChange={(e) => setDraft((prev) => ({ ...prev, unique_per_round: e.target.checked }))}
          />
          <span>同一轮不重复</span>
        </label>
      </div>

      <div style={tabBarStyle}>
        {Array.from({ length: slotCount }, (_, i) => {
          const slot = draft.slots[i];
          const isActive = i === activeSlot;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActiveSlot(i)}
              style={tabStyle(isActive)}
            >
              <span style={tabNameStyle}>{slot?.name || defaultSlotName(i)}</span>
              <span style={tabCountStyle}>{slot?.candidates.length || 0} 人</span>
            </button>
          );
        })}
      </div>

      {currentSlot ? (
        <div style={slotEditorStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>角色名称</span>
            <input
              type="text"
              value={currentSlot.name}
              onChange={(e) => handleSlotNameChange(e.target.value)}
              placeholder={defaultSlotName(activeSlot)}
              style={inputStyle}
            />
          </label>

          <TurntableUserPicker
            selectedUsers={currentSlot.candidates}
            onChange={handleSlotCandidatesChange}
            poolLabel={`${currentSlot.name} 候选池`}
          />
        </div>
      ) : null}
    </section>
  );
}

function ensureSlots(settings: SlotMachineSettings): SlotMachineSettings {
  const count = clampSlotCount(settings.slot_count);
  const slots = [...settings.slots];
  while (slots.length < count) {
    slots.push({ name: defaultSlotName(slots.length), candidates: [] });
  }
  return { ...settings, slot_count: count, slots: slots.slice(0, count) };
}

function dedupeUsers(users: SlotConfig["candidates"]) {
  const seen = new Set<number>();
  return users.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

const panelStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  padding: "18px",
  display: "grid",
  gap: "18px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "14px",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "22px",
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
};

const controlsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
  alignItems: "end",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const labelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 800,
};

const inputStyle: CSSProperties = {
  minHeight: "42px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "white",
  color: "var(--x-color-ink)",
  padding: "0 12px",
  fontSize: "15px",
};

const toggleStyle: CSSProperties = {
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  padding: "0 12px",
  fontWeight: 800,
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  flexWrap: "wrap",
};

const tabStyle = (active: boolean): CSSProperties => ({
  minHeight: "44px",
  padding: "6px 16px",
  border: active ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
  color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
  cursor: "pointer",
  display: "grid",
  justifyItems: "center",
  gap: "2px",
  fontWeight: 800,
});

const tabNameStyle: CSSProperties = {
  fontSize: "14px",
};

const tabCountStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};

const slotEditorStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: "42px",
  padding: "0 16px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "8px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  minHeight: "42px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  cursor: "pointer",
};
