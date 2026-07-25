import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { apiFetch } from "../../../js/apiFetch";

export type PlaceSelection = {
  location: string;
  place_id: string;
  lat: number | null;
  lng: number | null;
};

type Prediction = { place_id: string; description: string };

// 强制通过 Google 选择地址：输入触发 Places 自动完成，只有点选建议才会
// 回调 onSelect（带 place_id + 经纬度）。纯手打不会保存地点。
export function GooglePlaceInput({
  value,
  disabled,
  placeholder = "输入并从 Google 选择地址",
  onSelect,
  onClear,
}: {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onSelect: (v: PlaceSelection) => void;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState(value || "");
  const [preds, setPreds] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    const kw = query.trim();
    if (!open || kw.length < 2 || kw === (value || "").trim()) {
      setPreds([]);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/event_data/place/autocomplete?q=${encodeURIComponent(kw)}`, { credentials: "include" });
        const data = await res.json();
        if (seq.current !== mySeq) return;
        if (data.status === "success") {
          setPreds(Array.isArray(data.predictions) ? data.predictions : []);
          setError("");
        } else {
          setPreds([]);
          setError(data.message || "查询失败");
        }
      } catch {
        if (seq.current === mySeq) setError("网络错误");
      } finally {
        if (seq.current === mySeq) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  async function pick(p: Prediction) {
    setPicking(true);
    setError("");
    try {
      const res = await apiFetch(`/api/event_data/place/detail?place_id=${encodeURIComponent(p.place_id)}`, { credentials: "include" });
      const data = await res.json();
      if (data.status === "success" && data.place) {
        const place = data.place as PlaceSelection;
        setQuery(place.location);
        setPreds([]);
        setOpen(false);
        onSelect(place);
      } else {
        setError(data.message || "获取地址详情失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setPicking(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          style={inputStyle}
          value={query}
          disabled={disabled || picking}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 180); }}
        />
        {value && onClear ? (
          <button type="button" style={clearBtnStyle} disabled={disabled} onClick={() => { setQuery(""); setPreds([]); onClear(); }}>清除</button>
        ) : null}
      </div>
      {error ? <div style={errStyle}>{error}</div> : null}
      {open && (loading || preds.length) ? (
        <div
          style={dropStyle}
          onMouseDown={() => { if (blurTimer.current) window.clearTimeout(blurTimer.current); }}
        >
          {loading && !preds.length ? <div style={itemMutedStyle}>搜索中…</div> : null}
          {preds.map((p) => (
            <button key={p.place_id} type="button" style={itemStyle} disabled={picking} onClick={() => void pick(p)}>
              📍 {p.description}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const inputStyle: CSSProperties = { flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 7, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontSize: 13, boxSizing: "border-box" };
const clearBtnStyle: CSSProperties = { flexShrink: 0, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink-muted)", fontSize: 12, fontWeight: 700, cursor: "pointer" };
const dropStyle: CSSProperties = { position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 260, overflowY: "auto", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", borderRadius: 8, boxShadow: "0 12px 32px var(--x-color-shadow, rgba(0,0,0,0.15))", display: "grid" };
const itemStyle: CSSProperties = { textAlign: "left", padding: "9px 11px", border: "none", borderBottom: "1px solid var(--x-color-line-soft)", background: "transparent", color: "var(--x-color-ink)", fontSize: 12.5, cursor: "pointer" };
const itemMutedStyle: CSSProperties = { padding: "9px 11px", color: "var(--x-color-ink-muted)", fontSize: 12.5 };
const errStyle: CSSProperties = { marginTop: 4, fontSize: 11.5, color: "var(--x-color-danger)" };
