import { useState } from "react";
import type { CSSProperties } from "react";

import { mirrorPhotoUrl } from "./api";

/**
 * A member's entry selfie. Whenever a name is on screen this goes next to it;
 * the initial is only a fallback for a photo that failed to load.
 */
export function MirrorAvatar({
  token,
  memberId,
  name,
  photoAtMs,
  size,
}: {
  token: string;
  memberId: string;
  name: string;
  photoAtMs: number;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!photoAtMs || failed) {
    return (
      <span style={{ ...fallbackStyle, width: size, height: size, fontSize: Math.round(size * 0.42) }}>
        {name.slice(0, 1) || "?"}
      </span>
    );
  }

  return (
    <img
      src={mirrorPhotoUrl(token, memberId, photoAtMs)}
      alt={name}
      onError={() => setFailed(true)}
      style={{ ...imgStyle, width: size, height: size }}
    />
  );
}

const imgStyle: CSSProperties = {
  borderRadius: "999px",
  objectFit: "cover",
  background: "var(--x-color-panel-alt)",
  flex: "0 0 auto",
};

const fallbackStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 900,
  flex: "0 0 auto",
};
