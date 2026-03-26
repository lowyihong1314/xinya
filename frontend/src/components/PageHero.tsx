import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { useUserState } from "../app/UserState";
import { useEventData } from "../event/shared/EventDataContext";
import { API_BASE } from "../js/apiBase";
import { CacheMediaPlayer } from "./CacheMediaPlayer";

type PageHeroProps = {
  title: string;
  subtitle: string;
};

type HeroMediaItem = {
  id: number;
  fileType?: string | null;
};

const IMAGE_HERO_DURATION_MS = 5200;
const VIDEO_HERO_MAX_DURATION_MS = 15000;

export function PageHero({ title, subtitle }: PageHeroProps) {
  const { isMobile } = useUserState();
  const { events } = useEventData();
  const [activeIndex, setActiveIndex] = useState(0);
  const [pressed, setPressed] = useState(false);

  function advanceSlide() {
    setActiveIndex((prev) => (prev + 1) % mediaItems.length);
  }

  const mediaItems = useMemo<HeroMediaItem[]>(
    () =>
      events
        .filter((event) => event.event_image?.id)
        .slice(0, 10)
        .map((event) => ({
          id: Number(event.event_image?.id),
          fileType: event.event_image?.file_type,
        })),
    [events],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [mediaItems]);

  useEffect(() => {
    if (mediaItems.length <= 1) {
      return;
    }

    const activeMedia = mediaItems[activeIndex];
    const duration = isVideoType(activeMedia?.fileType) ? VIDEO_HERO_MAX_DURATION_MS : IMAGE_HERO_DURATION_MS;

    const timer = window.setTimeout(() => {
      advanceSlide();
    }, duration);

    return () => window.clearTimeout(timer);
  }, [activeIndex, mediaItems]);

  return (
    <section
      style={heroStyle(isMobile)}
      onMouseEnter={() => !isMobile && setPressed(true)}
      onMouseLeave={() => !isMobile && setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onTouchCancel={() => setPressed(false)}
    >
      {mediaItems.map((media, index) => (
        <div key={`${media.id}-${media.fileType || "unknown"}`} style={backdropLayerStyle(index === activeIndex)}>
          <CacheMediaPlayer
            fileId={media.id}
            fileType={media.fileType}
            containerStyle={heroMediaContainerStyle}
            style={backdropMediaStyle(index === activeIndex)}
            retryAttempts={6}
            retryDelayMs={1500}
            videoLoop={false}
            onVideoEnded={index === activeIndex && isVideoType(media.fileType) ? advanceSlide : undefined}
          />
        </div>
      ))}
      <div style={heroMaskStyle(pressed)} />
      <div style={heroContentStyle(isMobile)}>
        <div style={logoCircleStyle(isMobile)}>
          <img src={`${API_BASE}/static/images/logo/logo.png`} alt="logo" style={logoStyle(isMobile)} />
        </div>
        <h1 style={heroTitleStyle(isMobile)}>{title}</h1>
        <p style={heroSubtitleStyle(isMobile)}>{subtitle}</p>
      </div>
    </section>
  );
}

function isVideoType(fileType?: string | null) {
  return ["mp4", "mov", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"].includes(
    String(fileType || "").trim().toLowerCase(),
  );
}

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    minHeight: isMobile ? "46vh" : "68vh",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    margin: isMobile ? "0 0" : "0 24px",
    borderRadius: "0 0 var(--x-radius-lg) var(--x-radius-lg)",
    boxShadow: "0 28px 70px var(--x-color-shadow)",
    background:
      "linear-gradient(135deg, rgba(18,52,59,0.96), rgba(15,118,110,0.88), rgba(29,78,216,0.72))",
  };
}

function heroMaskStyle(pressed: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0.14)), linear-gradient(135deg, rgba(18,52,59,0.48), rgba(15,118,110,0.24), rgba(29,78,216,0.18))",
    backdropFilter: `blur(${pressed ? 1 : 10}px)`,
    transition: "backdrop-filter 160ms ease",
    zIndex: 1,
  };
}

function backdropLayerStyle(active: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    opacity: active ? 1 : 0,
    transition: "opacity 1600ms ease",
  };
}

function backdropMediaStyle(active: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: active ? "scale(1.02)" : "scale(1.08)",
    transition: "transform 5200ms ease",
    filter: "saturate(1.08) contrast(1.02)",
    pointerEvents: "none",
    display: "block",
    background: "transparent",
  };
}

const heroMediaContainerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  height: "100%",
};

function heroContentStyle(isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    zIndex: 2,
    display: "grid",
    justifyItems: "center",
    gap: isMobile ? "10px" : "14px",
    padding: isMobile ? "36px 18px" : "56px 28px",
    textAlign: "center",
  };
}

function logoCircleStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "84px" : "112px",
    height: isMobile ? "84px" : "112px",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.14)",
    display: "grid",
    placeItems: "center",
    marginBottom: "4px",
    boxShadow: "0 16px 36px rgba(0,0,0,0.22)",
  };
}

function logoStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "54px" : "72px",
    height: isMobile ? "54px" : "72px",
    objectFit: "contain",
  };
}

function heroTitleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "clamp(34px, 12vw, 52px)" : "clamp(42px, 8vw, 76px)",
    lineHeight: 0.95,
    color: "var(--x-color-ink)",
  };
}

function heroSubtitleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "14px" : "20px",
    letterSpacing: isMobile ? "0.16em" : "0.28em",
    opacity: 0.86,
    color: "var(--x-color-ink)",
  };
}
