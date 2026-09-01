import type { CSSProperties } from "react";
import { Easing, interpolate, spring } from "remotion";
import type { JsonVideoAnimation } from "./schema";

const easingFor = (
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out",
) => {
  if (easing === "linear") return Easing.linear;
  if (easing === "ease-in") return Easing.in(Easing.cubic);
  if (easing === "ease-in-out") return Easing.inOut(Easing.cubic);
  return Easing.out(Easing.cubic);
};

export const getAnimationProgress = (
  animation: JsonVideoAnimation,
  frame: number,
  fps: number,
) => {
  if (
    animation.type === "spring-in" ||
    animation.type === "bounce-in" ||
    animation.type === "char-bounce-in"
  ) {
    return spring({
      frame: Math.max(0, frame - animation.from),
      fps,
      durationInFrames: animation.durationInFrames,
      config: {
        damping: animation.damping,
        mass: animation.mass,
        stiffness: animation.stiffness,
      },
    });
  }

  if (animation.type === "typewriter") {
    return interpolate(
      frame,
      [animation.from, animation.from + animation.durationInFrames],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  }

  return interpolate(
    frame,
    [animation.from, animation.from + animation.durationInFrames],
    [0, 1],
    {
      easing: easingFor(animation.easing),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
};

const movementVector = (
  direction: "up" | "down" | "left" | "right",
  distance: number,
) => {
  if (direction === "up") return { x: 0, y: -distance };
  if (direction === "down") return { x: 0, y: distance };
  if (direction === "left") return { x: -distance, y: 0 };
  return { x: distance, y: 0 };
};

export const getAnimationValues = ({
  animations,
  frame,
  fps,
  baseOpacity,
}: {
  animations: JsonVideoAnimation[];
  frame: number;
  fps: number;
  baseOpacity: number;
}) => {
  let opacity = baseOpacity;
  let translateX = 0;
  let translateY = 0;
  let scale = 1;
  let rotation = 0;
  let blur = 0;
  let clipPath: string | undefined;

  for (const animation of animations) {
    const progress = getAnimationProgress(animation, frame, fps);

    if (animation.type === "fade-in") opacity *= progress;
    if (animation.type === "fade-out") opacity *= 1 - progress;

    if (animation.type === "slide-in") {
      const vector = movementVector(animation.direction, animation.distance);
      translateX += -vector.x * (1 - progress);
      translateY += -vector.y * (1 - progress);
    }

    if (animation.type === "slide-out") {
      const vector = movementVector(animation.direction, animation.distance);
      translateX += vector.x * progress;
      translateY += vector.y * progress;
    }

    if (animation.type === "scale-in") {
      scale *= animation.fromScale + (1 - animation.fromScale) * progress;
    }
    if (animation.type === "scale-out") {
      scale *= 1 + (animation.toScale - 1) * progress;
    }
    if (animation.type === "rotate-in") {
      rotation += animation.fromDegrees * (1 - progress);
    }
    if (animation.type === "rotate-out") {
      rotation += animation.toDegrees * progress;
    }
    if (animation.type === "spring-in") {
      opacity *= interpolate(progress, [0, 1], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      scale *= animation.fromScale + (1 - animation.fromScale) * progress;
    }

    if (animation.type === "blur-in") {
      blur += animation.blur * (1 - progress);
    }
    if (animation.type === "shine-in") opacity *= progress;
    if (animation.type === "blur-out") {
      blur += animation.blur * progress;
    }
    if (animation.type === "reveal-in") {
      const hidden = (1 - progress) * 100;
      if (animation.direction === "left") {
        clipPath = `inset(0 ${hidden}% 0 0)`;
      } else if (animation.direction === "right") {
        clipPath = `inset(0 0 0 ${hidden}%)`;
      } else if (animation.direction === "up") {
        clipPath = `inset(0 0 ${hidden}% 0)`;
      } else {
        clipPath = `inset(${hidden}% 0 0 0)`;
      }
    }
    if (animation.type === "bounce-in") {
      const vector = movementVector(animation.direction, animation.distance);
      translateX += -vector.x * (1 - progress);
      translateY += -vector.y * (1 - progress);
      opacity *= Math.max(0, Math.min(1, progress));
    }
    if (animation.type === "pulse") {
      const wave = Math.sin(progress * animation.cycles * Math.PI * 2);
      scale *= 1 + (animation.scale - 1) * Math.max(0, wave);
    }
    if (animation.type === "shake") {
      const wave = Math.sin(progress * animation.cycles * Math.PI * 2);
      translateX += wave * animation.amplitude * (1 - progress);
    }
    if (animation.type === "float") {
      const wave = Math.sin(progress * animation.cycles * Math.PI * 2);
      if (animation.axis === "x") translateX += wave * animation.distance;
      if (animation.axis === "y") translateY += wave * animation.distance;
    }
    if (animation.type === "ken-burns") {
      scale *=
        animation.fromScale +
        (animation.toScale - animation.fromScale) * progress;
      translateX +=
        animation.fromX + (animation.toX - animation.fromX) * progress;
      translateY +=
        animation.fromY + (animation.toY - animation.fromY) * progress;
    }
  }

  return { opacity, translateX, translateY, scale, rotation, blur, clipPath };
};

export const getAnimatedStyle = (
  options: Parameters<typeof getAnimationValues>[0],
): CSSProperties => {
  const { opacity, translateX, translateY, scale, rotation, blur, clipPath } =
    getAnimationValues(options);

  return {
    opacity,
    translate: `${translateX}px ${translateY}px`,
    scale,
    rotate: `${rotation}deg`,
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
    clipPath,
  };
};
