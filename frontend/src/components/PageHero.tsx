import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { useUserState } from "../app/UserState";
import { useEventData } from "../event/shared/EventDataContext";
import { API_BASE } from "../js/apiBase";
import { CacheMediaPlayer } from "./CacheMediaPlayer";
import { CachedImage } from "./CachedMedia";

type PageHeroProps = {
  title: string;
  subtitle: string;
  idPrefix?: string;
  tone?: "default" | "sky";
};

type HeroMediaItem = {
  id: number;
  fileType?: string | null;
};

const IMAGE_HERO_DURATION_MS = 5200;
const VIDEO_HERO_MAX_DURATION_MS = 15000;

export function PageHero({ title, subtitle, idPrefix = "page-hero", tone = "default" }: PageHeroProps) {
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
      id={`${idPrefix}-section`}
      style={heroStyle(isMobile, tone)}
      onMouseEnter={() => !isMobile && setPressed(true)}
      onMouseLeave={() => !isMobile && setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      onTouchCancel={() => setPressed(false)}
    >
      {mediaItems.map((media, index) => (
        <div
          key={`${media.id}-${media.fileType || "unknown"}`}
          id={`${idPrefix}-media-layer-${index}`}
          style={backdropLayerStyle(index === activeIndex)}
        >
          <CacheMediaPlayer
            id={`${idPrefix}-media-${media.id}-${index}`}
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
      <div id={`${idPrefix}-mask`} style={heroMaskStyle(pressed, tone)} />
      <div id={`${idPrefix}-content`} style={heroContentStyle(isMobile)}>
        <div id={`${idPrefix}-logo-wrap`} style={logoCircleStyle(isMobile, tone)}>
          <CachedImage
            id={`${idPrefix}-logo`}
            src={`${API_BASE}/static/images/logo/logo.png`}
            cacheKey="page-hero-logo"
            alt="logo"
            style={logoStyle(isMobile)}
          />
        </div>
        <h1 id={`${idPrefix}-title`} style={heroTitleStyle(isMobile, tone)}>{title}</h1>
        <p id={`${idPrefix}-subtitle`} style={heroSubtitleStyle(isMobile, tone)}>{subtitle}</p>
      </div>
    </section>
  );
}

function isVideoType(fileType?: string | null) {
  return ["mp4", "mov", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"].includes(
    String(fileType || "").trim().toLowerCase(),
  );
}

function heroStyle(isMobile: boolean, tone: PageHeroProps["tone"]): CSSProperties {
  return {
    position: "relative",
    minHeight: isMobile ? "46vh" : "68vh",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    margin: tone === "sky" ? 0 : isMobile ? "0 0" : "0 24px",
    padding: 0,
    borderRadius: tone === "sky" ? 0 : "0 0 var(--x-radius-lg) var(--x-radius-lg)",
    boxShadow: tone === "sky" ? "0 28px 70px rgba(14, 116, 144, 0.14)" : "0 28px 70px var(--x-color-shadow)",
    background: tone === "sky"
      ? "linear-gradient(135deg, rgba(224, 247, 255, 0.98), rgba(186, 230, 253, 0.88), rgba(240, 249, 255, 0.92))"
      : "linear-gradient(135deg, rgba(18,52,59,0.96), rgba(15,118,110,0.88), rgba(29,78,216,0.72))",
  };
}

function heroMaskStyle(pressed: boolean, tone: PageHeroProps["tone"]): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background: tone === "sky"
      ? "linear-gradient(180deg, rgba(238,249,255,0.74), rgba(224,247,255,0.46)), linear-gradient(135deg, rgba(56,189,248,0.22), rgba(14,165,233,0.12), rgba(255,255,255,0.1))"
      : "linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0.14)), linear-gradient(135deg, rgba(18,52,59,0.48), rgba(15,118,110,0.24), rgba(29,78,216,0.18))",
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

function logoCircleStyle(isMobile: boolean, tone: PageHeroProps["tone"]): CSSProperties {
  return {
    width: isMobile ? "84px" : "112px",
    height: isMobile ? "84px" : "112px",
    borderRadius: "50%",
    background: tone === "sky" ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.14)",
    display: "grid",
    placeItems: "center",
    marginBottom: "4px",
    boxShadow: tone === "sky" ? "0 16px 36px rgba(14,116,144,0.14)" : "0 16px 36px rgba(0,0,0,0.22)",
  };
}

function logoStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "54px" : "72px",
    height: isMobile ? "54px" : "72px",
    objectFit: "contain",
  };
}

function heroTitleStyle(isMobile: boolean, tone: PageHeroProps["tone"]): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "44px" : "72px",
    lineHeight: 0.95,
    color: tone === "sky" ? "rgba(12,74,110,0.98)" : "var(--x-color-ink)",
  };
}

function heroSubtitleStyle(isMobile: boolean, tone: PageHeroProps["tone"]): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "14px" : "20px",
    letterSpacing: 0,
    opacity: 0.86,
    color: tone === "sky" ? "rgba(31,78,121,0.9)" : "var(--x-color-ink)",
  };
}
