import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { apiFetch } from "../js/apiFetch";

// Maps Embed key 由后端 /api/event_data/maps/config 提供（.flaskenv 里的
// VITE_GOOGLE_MAPS_EMBED_API_KEY 不会进前端构建，所以运行时向后端取）。模块级缓存一次。
let keyPromise: Promise<string> | null = null;
function getEmbedKey(): Promise<string> {
  if (!keyPromise) {
    keyPromise = apiFetch("/api/event_data/maps/config")
      .then((r) => r.json())
      .then((d) => (typeof d?.embed_key === "string" ? d.embed_key : ""))
      .catch(() => "");
  }
  return keyPromise;
}

function buildQuery(opts: { placeId?: string | null; lat?: number | null; lng?: number | null; query?: string | null }): string | null {
  if (opts.placeId) return `place_id:${opts.placeId}`;
  if (opts.lat != null && opts.lng != null) return `${opts.lat},${opts.lng}`;
  if (opts.query && opts.query.trim()) return opts.query.trim();
  return null;
}

export function GoogleMapEmbed({
  placeId,
  lat,
  lng,
  query,
  height = 220,
  rounded = true,
}: {
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  query?: string | null;
  height?: number;
  rounded?: boolean;
}) {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getEmbedKey().then((k) => {
      if (active) setKey(k);
    });
    return () => {
      active = false;
    };
  }, []);

  const q = buildQuery({ placeId, lat, lng, query });
  if (!q) return null;

  const wrapStyle: CSSProperties = {
    width: "100%",
    height,
    borderRadius: rounded ? 12 : 0,
    overflow: "hidden",
    border: "1px solid var(--x-color-line-soft, #e5e7eb)",
    background: "var(--x-color-panel-alt, #f3f4f6)",
  };

  // key 未取到（未配置/加载中）→ 退化为「在 Google 地图打开」链接。
  if (!key) {
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || (lat != null && lng != null ? `${lat},${lng}` : ""))}${placeId ? `&query_place_id=${placeId}` : ""}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...wrapStyle, height: "auto", display: "block", padding: "12px 14px", fontSize: 13, color: "var(--x-color-accent-strong, #4338ca)", textDecoration: "none", fontWeight: 700 }}
      >
        📍 在 Google 地图查看
      </a>
    );
  }

  const src = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}`;
  return (
    <div style={wrapStyle}>
      <iframe
        title="地点地图"
        src={src}
        width="100%"
        height={height}
        style={{ border: 0, display: "block" }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </div>
  );
}
