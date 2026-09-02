import { useMemo, type CSSProperties } from "react";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { Audio, Video } from "@remotion/media";
import {
  AnimatedImage,
  CanvasImage,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  getAnimatedStyle,
  getAnimationProgress,
  getAnimationValues,
} from "./animations";
import type { JsonVideoElement } from "./schema";

// Captions sit on top of arbitrary footage, so legibility comes from a layered
// text shadow (offset drop shadow plus a tight glow) instead of a solid plate.
const getCaptionTextShadow = (color: string, blur: number) => {
  if (blur <= 0) return undefined;
  const offset = Math.max(1, Math.round(blur / 6));
  const glow = Math.max(1, Math.round(blur / 2));
  return `0 ${offset}px ${blur}px ${color}, 0 0 ${glow}px ${color}`;
};

const getCaptionMotionStyle = (
  preset: "none" | "fade" | "rise" | "word-highlight",
  currentTimeMs: number,
  startMs: number,
  endMs: number,
): CSSProperties => {
  if (preset === "none" || preset === "word-highlight") return {};
  const enter = interpolate(currentTimeMs, [startMs, Math.min(endMs, startMs + 180)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(currentTimeMs, [Math.max(startMs, endMs - 150), endMs], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(enter, exit);
  return preset === "rise"
    ? { opacity, translate: `0 ${18 * (1 - enter)}px` }
    : { opacity };
};

const CaptionsContent: React.FC<{
  element: Extract<JsonVideoElement, { type: "captions" }>;
}> = ({ element }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions: element.captions,
        combineTokensWithinMilliseconds:
          element.combineTokensWithinMilliseconds,
      }),
    [element.captions, element.combineTokensWithinMilliseconds],
  );
  const textShadow = getCaptionTextShadow(
    element.style.shadowColor,
    element.style.shadowBlur,
  );
  const currentTimeMs = (frame / fps) * 1000;
  const activeCaption = element.captions.find(
    (caption) =>
      caption.startMs <= currentTimeMs && currentTimeMs < caption.endMs,
  );
  if (element.displayMode === "sentence") {
    if (!activeCaption) return null;
    return (
      <div
        style={{
          width: element.style.width,
          color: element.style.color,
          fontFamily: element.style.fontFamily,
          fontSize: element.style.fontSize,
          fontWeight: element.style.fontWeight,
          lineHeight: element.style.lineHeight,
          textAlign: element.style.textAlign,
          textShadow,
          padding: element.style.padding,
          whiteSpace: "nowrap",
          boxSizing: "border-box",
          ...getCaptionMotionStyle(
            element.animationPreset,
            currentTimeMs,
            activeCaption.startMs,
            activeCaption.endMs,
          ),
        }}
      >
        {activeCaption.text}
      </div>
    );
  }
  const page = pages.find((candidate, index) => {
    const nextPage = pages[index + 1];
    const lastToken = candidate.tokens[candidate.tokens.length - 1];
    const pageEndMs = nextPage?.startMs ?? lastToken?.toMs ?? candidate.startMs;
    return candidate.startMs <= currentTimeMs && currentTimeMs < pageEndMs;
  });

  if (!page) return null;

  return (
    <div
      style={{
        width: element.style.width,
        color: element.style.color,
        fontFamily: element.style.fontFamily,
        fontSize: element.style.fontSize,
        fontWeight: element.style.fontWeight,
        lineHeight: element.style.lineHeight,
        textAlign: element.style.textAlign,
        textShadow,
        padding: element.style.padding,
        whiteSpace: "nowrap",
        boxSizing: "border-box",
      }}
    >
      {page.tokens.map((token, tokenIndex) => (
        <span
          key={`${token.fromMs}-${tokenIndex}`}
          style={{
            color:
              token.fromMs <= currentTimeMs && token.toMs > currentTimeMs
                ? element.style.highlightColor
                : element.style.color,
          }}
        >
          {token.text}
        </span>
      ))}
    </div>
  );
};

type VisualElement = Exclude<JsonVideoElement, { type: "audio" }>;

const ElementContent: React.FC<{ element: VisualElement }> = ({ element }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (element.type === "text") {
    const contentAnimation = element.animations.find(
      (animation) =>
        animation.type === "typewriter" ||
        animation.type === "count-up" ||
        animation.type === "char-bounce-in",
    );
    const shineAnimation = element.animations.find(
      (animation) => animation.type === "shine-in",
    );
    const shineIsActive = shineAnimation
      && frame >= shineAnimation.from
      && frame < shineAnimation.from + shineAnimation.durationInFrames;
    let content = element.content;

    if (contentAnimation?.type === "typewriter") {
      const progress = getAnimationProgress(contentAnimation, frame, fps);
      const characters = Array.from(element.content);
      const visibleCharacters = Math.floor(progress * characters.length);
      const cursorIsVisible =
        contentAnimation.showCursor &&
        progress < 1 &&
        Math.floor(frame / 8) % 2 === 0;
      content =
        characters.slice(0, visibleCharacters).join("") +
        (cursorIsVisible ? contentAnimation.cursor : "");
    }

    if (contentAnimation?.type === "count-up") {
      const progress = getAnimationProgress(contentAnimation, frame, fps);
      const value =
        contentAnimation.fromValue +
        (contentAnimation.toValue - contentAnimation.fromValue) * progress;
      const formattedValue = contentAnimation.thousandsSeparator
        ? new Intl.NumberFormat("en-US", {
            minimumFractionDigits: contentAnimation.decimals,
            maximumFractionDigits: contentAnimation.decimals,
          }).format(value)
        : value.toFixed(contentAnimation.decimals);
      content = `${contentAnimation.prefix}${formattedValue}${contentAnimation.suffix}`;
    }

    const textStyle: CSSProperties = shineAnimation && shineIsActive
      ? {
          color: "transparent",
          backgroundImage: `linear-gradient(110deg, ${element.style.color} 30%, ${shineAnimation.shineColor} 50%, ${element.style.color} 70%)`,
          backgroundSize: "250% 100%",
          backgroundPosition: `${interpolate(
            frame,
            [
              shineAnimation.from,
              shineAnimation.from + shineAnimation.durationInFrames,
            ],
            [200, -100],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )}% 0`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }
      : { color: element.style.color };
    const sharedStyle: CSSProperties = {
      width: element.style.width,
      fontFamily: element.style.fontFamily,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight,
      lineHeight: element.style.lineHeight,
      textAlign: element.style.textAlign,
      backgroundColor: element.style.backgroundColor,
      padding: element.style.padding,
      borderRadius: element.style.borderRadius,
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      boxSizing: "border-box",
      ...textStyle,
    };

    if (contentAnimation?.type === "char-bounce-in") {
      const characters = Array.from(element.content);
      const maxStagger =
        (contentAnimation.durationInFrames * 0.65) /
        Math.max(1, characters.length - 1);
      const stagger = Math.min(contentAnimation.staggerFrames, maxStagger);
      return (
        <div style={sharedStyle}>
          {characters.map((character, index) => {
            const offset = index * stagger;
            const progress = spring({
              frame: Math.max(0, frame - contentAnimation.from - offset),
              fps,
              durationInFrames: Math.max(
                6,
                contentAnimation.durationInFrames - offset,
              ),
              config: {
                damping: contentAnimation.damping,
                mass: contentAnimation.mass,
                stiffness: contentAnimation.stiffness,
              },
            });
            return (
              <span
                key={`${character}-${index}`}
                style={{
                  display: "inline-block",
                  opacity: interpolate(progress, [0, 1], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                  translate: `0 ${contentAnimation.fromY * (1 - progress)}px`,
                  scale:
                    contentAnimation.fromScale +
                    (1 - contentAnimation.fromScale) * progress,
                  whiteSpace: character === " " ? "pre" : undefined,
                }}
              >
                {character}
              </span>
            );
          })}
        </div>
      );
    }

    return (
      <div
        style={sharedStyle}
      >
        {content}
      </div>
    );
  }

  if (element.type === "shape") {
    return (
      <div
        style={{
          width: element.size.width,
          height: element.size.height,
          backgroundColor: element.style.backgroundColor,
          borderColor: element.style.borderColor,
          borderStyle: element.style.borderWidth > 0 ? "solid" : undefined,
          borderWidth: element.style.borderWidth,
          borderRadius:
            element.shape === "ellipse" ? "50%" : element.style.borderRadius,
          boxSizing: "border-box",
        }}
      />
    );
  }

  if (element.type === "image") {
    return (
      <CanvasImage
        src={element.src}
        style={{
          width: element.size.width,
          height: element.size.height,
          objectFit: element.style.objectFit,
          borderRadius: element.style.borderRadius,
        }}
      />
    );
  }

  if (element.type === "video") {
    return (
      <Video
        src={element.src}
        style={{
          width: element.size.width,
          height: element.size.height,
          borderRadius: element.style.borderRadius,
        }}
        objectFit={element.style.objectFit}
        volume={() => element.volume}
        muted={element.muted}
        playbackRate={element.playbackRate}
        trimBefore={element.trimBefore}
        loop={element.loop}
        toneFrequency={element.toneFrequency}
      />
    );
  }

  if (element.type === "gif") {
    return (
      <AnimatedImage
        src={element.src}
        width={element.size.width}
        height={element.size.height}
        fit={element.fit}
        playbackRate={element.playbackRate}
        loopBehavior={element.loopBehavior}
        style={{ borderRadius: element.borderRadius }}
      />
    );
  }

  return <CaptionsContent element={element} />;
};

const AudioElement: React.FC<{
  element: Extract<JsonVideoElement, { type: "audio" }>;
}> = ({ element }) => {
  const { fps } = useVideoConfig();

  return (
    <Audio
      src={element.src}
      volume={(audioFrame) =>
        getAnimationValues({
          animations: element.animations,
          frame: audioFrame,
          fps,
          baseOpacity: element.volume,
        }).opacity
      }
      playbackRate={element.playbackRate}
      trimBefore={element.trimBefore}
      loop={element.loop}
      toneFrequency={element.toneFrequency}
    />
  );
};

export const JsonElement: React.FC<{ element: JsonVideoElement }> = ({
  element,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (element.type === "audio") return <AudioElement element={element} />;

  const anchorStyle: CSSProperties =
    element.position.anchor === "center"
      ? { translate: "-50% -50%" }
      : { translate: "0 0" };

  return (
    <div
      style={{
        position: "absolute",
        left: element.position.x,
        top: element.position.y,
        zIndex: element.zIndex,
        ...anchorStyle,
      }}
    >
      <div
        style={getAnimatedStyle({
          animations: element.animations,
          frame,
          fps,
          baseOpacity: element.opacity,
        })}
      >
        <ElementContent element={element} />
      </div>
    </div>
  );
};
