import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type CompositionEvent,
} from "react";

type MusicSearchInputProps = {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

export function MusicSearchInput({
  value,
  placeholder = "搜索歌曲或专辑",
  onChange,
}: MusicSearchInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) {
      setDraft(value);
    }
  }, [value]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setDraft(nextValue);
    if (!composingRef.current) {
      onChange(nextValue);
    }
  }

  function handleCompositionStart() {
    composingRef.current = true;
    setComposing(true);
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    const nextValue = event.currentTarget.value;
    composingRef.current = false;
    setComposing(false);
    setDraft(nextValue);
    onChange(nextValue);
  }

  function handleClear() {
    composingRef.current = false;
    setComposing(false);
    setDraft("");
    onChange("");
  }

  return (
    <div style={searchFieldStyle(focused)}>
      <i className="fa-solid fa-magnifying-glass" aria-hidden="true" style={searchIconStyle} />
      <input
        value={draft}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={searchInputStyle(Boolean(draft))}
      />
      {draft && !composing ? (
        <button
          type="button"
          aria-label="清空搜索"
          title="清空搜索"
          style={clearButtonStyle}
          onClick={handleClear}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

const searchFieldStyle = (focused: boolean): CSSProperties => ({
  position: "relative",
  display: "grid",
  alignItems: "center",
  width: "100%",
  minWidth: 0,
  minHeight: "46px",
  borderRadius: "14px",
  border: focused ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxShadow: focused ? "0 0 0 3px rgba(75, 120, 255, 0.14)" : "none",
  transition: "border-color 160ms ease, box-shadow 160ms ease",
  boxSizing: "border-box",
});

const searchIconStyle: CSSProperties = {
  position: "absolute",
  left: "15px",
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: "14px",
  color: "var(--x-color-ink-muted)",
  pointerEvents: "none",
};

const searchInputStyle = (hasValue: boolean): CSSProperties => ({
  width: "100%",
  minWidth: 0,
  minHeight: "44px",
  padding: hasValue ? "0 44px 0 42px" : "0 14px 0 42px",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--x-color-ink)",
  font: "inherit",
  boxSizing: "border-box",
});

const clearButtonStyle: CSSProperties = {
  position: "absolute",
  right: "6px",
  top: "50%",
  transform: "translateY(-50%)",
  display: "grid",
  placeItems: "center",
  width: "34px",
  height: "34px",
  border: "none",
  borderRadius: "10px",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  cursor: "pointer",
};
