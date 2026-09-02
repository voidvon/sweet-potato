/* eslint-disable @remotion/non-pure-animation -- This file compiles declarative motion metadata and does not render React animation. */
import { z } from "zod";
import {
  CURRENT_JSON_VIDEO_VERSION,
  jsonVideoSchema,
  type JsonVideoAnimation,
  type JsonVideoElement,
  type JsonVideoProps,
} from "../src/JsonVideo/schema";
import {
  motionRegistry,
  textPositions,
  videoPresets,
} from "../src/motion/registry";

const ids = <T extends readonly { id: string }[]>(items: T) =>
  items.map((item) => item.id) as [T[number]["id"], ...T[number]["id"][]];

const captionInputSchema = z
  .object({
    text: z.string().min(1),
    startMs: z.number().min(0),
    endMs: z.number().positive(),
    timestampMs: z.number().min(0).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .strict();

const sceneMotionSchema = z
  .object({
    sceneId: z.string().min(1),
    imageAssetIds: z.array(z.string().min(1)),
    layout: z.object({
      titlePosition: z.enum(textPositions),
      subtitlePosition: z.enum(textPositions),
    }).strict(),
    text: z.object({
      titleEntrance: z.enum(ids(motionRegistry.textEntrance)),
      subtitleEntrance: z.enum(ids(motionRegistry.textEntrance)),
      emphasis: z.enum(ids(motionRegistry.textEmphasis)),
      titleColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      subtitleColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    }).strict(),
    image: z.object({
      motion: z.enum(ids(motionRegistry.imageMotion)),
      transition: z.enum(ids(motionRegistry.imageTransition)),
    }).strict(),
    scene: z.object({
      transition: z.enum(ids(motionRegistry.sceneTransition)),
    }).strict(),
    caption: z.object({
      animation: z.enum(ids(motionRegistry.captionAnimation)),
    }).strict(),
  })
  .strict();

export const composeRequestSchema = z
  .object({
    presetId: z.enum(ids(videoPresets)),
    visualStyle: z.string(),
    scenes: z.array(z.object({
      id: z.string().min(1),
      title: z.string(),
      subtitle: z.string(),
      cta: z.string(),
      durationMs: z.number().int().positive(),
      images: z.array(z.object({
        assetId: z.string().min(1),
        url: z.url(),
      }).strict()).min(1),
      narration: z.object({
        assetId: z.string().min(1),
        url: z.url(),
        startMs: z.number().min(0),
        captions: z.array(captionInputSchema),
      }).strict(),
    }).strict()).min(1),
    motionPlan: z.object({ scenes: z.array(sceneMotionSchema) }).strict(),
  })
  .strict();

type ComposeRequest = z.infer<typeof composeRequestSchema>;
type SceneMotion = z.infer<typeof sceneMotionSchema>;

const defaultFps = 30;

const splitFrames = (total: number, parts: number) => {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
};

const buildImageTimeline = (total: number, count: number) => {
  if (count === 1) return [{ from: 0, duration: total, fadeIn: 0 }];
  const overlapBase = 12;
  const overlap = Math.min(overlapBase, Math.max(6, Math.floor(total / (count * 4))));
  const durations = splitFrames(total + overlap * (count - 1), count);
  let from = 0;
  return durations.map((duration, index) => {
    const entry = { from, duration, fadeIn: index === 0 ? 0 : Math.min(overlap, duration) };
    from += duration - overlap;
    return entry;
  });
};

const imageAnimations = (
  motion: SceneMotion["image"]["motion"],
  duration: number,
  fadeIn: number,
): JsonVideoAnimation[] => {
  const movement: JsonVideoAnimation = motion === "slow-zoom"
    ? { type: "scale-in", from: 0, durationInFrames: duration, easing: "linear", fromScale: 1.08 }
    : { type: "ken-burns", from: 0, durationInFrames: duration, easing: "linear", fromScale: 1, toScale: 1.12, fromX: 0, toX: 0, fromY: 0, toY: 0 };
  if (fadeIn === 0) return [movement];
  return [movement, { type: "fade-in", from: 0, durationInFrames: fadeIn, easing: "ease-in-out" }];
};

const textEntranceAnimations = (
  entrance: SceneMotion["text"]["titleEntrance"],
  emphasis: SceneMotion["text"]["emphasis"],
  elementDuration: number,
  delayed: boolean,
  exitDuration: number,
): JsonVideoAnimation[] => {
  let from = delayed && elementDuration >= 24 ? Math.min(6, Math.floor(elementDuration / 5)) : 0;
  let duration = Math.min(30, elementDuration - from);
  if (duration < 1) {
    duration = 1;
    from = Math.max(0, elementDuration - 1);
  }
  const fade = (): JsonVideoAnimation => ({ type: "fade-in", from, durationInFrames: duration, easing: "ease-out" });
  let result: JsonVideoAnimation[];
  switch (entrance) {
    case "slide":
      result = [{ type: "slide-in", from, durationInFrames: duration, easing: "ease-out", direction: "up", distance: 64 }, fade()];
      break;
    case "scale":
      result = [{ type: "scale-in", from, durationInFrames: duration, easing: "ease-out", fromScale: 0.78 }, fade()];
      break;
    case "blur":
      result = [{ type: "blur-in", from, durationInFrames: duration, easing: "ease-out", blur: 18 }, fade()];
      break;
    case "spring":
      result = [{ type: "spring-in", from, durationInFrames: duration, fromScale: 0.72, damping: 120, mass: 1, stiffness: 140 }];
      break;
    case "bounce":
      result = [{ type: "bounce-in", from, durationInFrames: duration, direction: "up", distance: 48, damping: 14, mass: 0.8, stiffness: 150 }];
      break;
    case "typewriter":
      result = [{ type: "typewriter", from, durationInFrames: duration, cursor: "|", showCursor: true }];
      break;
    case "char-bounce":
      result = [{ type: "char-bounce-in", from, durationInFrames: duration, staggerFrames: 2, fromY: 36, fromScale: 0.65, damping: 14, mass: 0.8, stiffness: 150 }];
      break;
    default:
      result = [fade()];
  }
  if (emphasis === "shine") {
    const shineFrom = Math.min(elementDuration - 1, from + duration);
    const shineDuration = Math.max(1, elementDuration - shineFrom - exitDuration);
    result.push({ type: "shine-in", from: shineFrom, durationInFrames: shineDuration, easing: "linear", shineColor: "#FFFFFF" });
  } else if (emphasis === "pulse") {
    result.push({ type: "pulse", from: Math.min(elementDuration - 1, from + duration), durationInFrames: Math.max(1, Math.min(30, elementDuration - from - duration)), easing: "ease-in-out", scale: 1.06, cycles: 1 });
  }
  if (exitDuration > 0) {
    const safeExitDuration = Math.min(exitDuration, elementDuration);
    result.push({
      type: "fade-out",
      from: elementDuration - safeExitDuration,
      durationInFrames: safeExitDuration,
      easing: "ease-in-out",
    });
  }
  return result;
};

const textPlacement = (position: typeof textPositions[number], subtitle: boolean) => {
  const roleY = (titleY: number, subtitleY: number) => subtitle ? subtitleY : titleY;
  switch (position) {
    case "top_left": return { x: 580, y: roleY(170, 340), width: 760, align: "left" as const };
    case "top_right": return { x: 1340, y: roleY(170, 340), width: 760, align: "right" as const };
    case "bottom_left": return { x: 580, y: roleY(600, 780), width: 760, align: "left" as const };
    case "bottom_right": return { x: 1340, y: roleY(600, 780), width: 760, align: "right" as const };
    default: return { x: 960, y: roleY(430, 610), width: 1560, align: "center" as const };
  }
};

const textElement = (
  id: string,
  content: string,
  duration: number,
  position: typeof textPositions[number],
  entrance: SceneMotion["text"]["titleEntrance"],
  emphasis: SceneMotion["text"]["emphasis"],
  color: string,
  subtitle: boolean,
  exitDuration: number,
): JsonVideoElement => {
  const placement = textPlacement(position, subtitle);
  return {
    id,
    type: "text",
    content,
    from: 0,
    durationInFrames: duration,
    position: { x: placement.x, y: placement.y, anchor: "center" },
    zIndex: 3,
    opacity: 1,
    animations: textEntranceAnimations(entrance, emphasis, duration, subtitle, exitDuration),
    style: {
      width: placement.width,
      fontSize: subtitle ? 46 : 84,
      fontFamily: "Arial, sans-serif",
      fontWeight: 700,
      lineHeight: 1.2,
      color,
      textAlign: placement.align,
      backgroundColor: "transparent",
      padding: 0,
      borderRadius: 0,
    },
  };
};

const captionCharacterWeight = (character: string) => character.codePointAt(0)! <= 0x7f ? 0.55 : 1;

const splitCaptionText = (text: string, maxVisualUnits = 18) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts: string[] = [];
  let current = "";
  let units = 0;
  for (const character of Array.from(normalized)) {
    const weight = captionCharacterWeight(character);
    if (current && units + weight > maxVisualUnits) {
      parts.push(current.trim());
      current = "";
      units = 0;
    }
    current += character;
    units += weight;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const localCaptions = (captions: ComposeRequest["scenes"][number]["narration"]["captions"], startMs: number, durationMs: number) =>
  captions.flatMap((caption) => {
    const start = Math.max(0, Math.round(caption.startMs - startMs));
    const end = Math.min(durationMs, Math.round(caption.endMs - startMs));
    if (end <= start) return [];
    const parts = splitCaptionText(caption.text);
    const weights = parts.map((part) => Array.from(part).reduce((sum, character) => sum + captionCharacterWeight(character), 0));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let elapsedWeight = 0;
    return parts.map((part, index) => {
      const partStart = start + Math.round(((end - start) * elapsedWeight) / totalWeight);
      elapsedWeight += weights[index];
      const partEnd = index === parts.length - 1
        ? end
        : start + Math.round(((end - start) * elapsedWeight) / totalWeight);
      return { ...caption, text: part, startMs: partStart, endMs: Math.max(partStart + 1, partEnd), timestampMs: partStart };
    });
  });

const defaultMotion = (sceneId: string, preset: typeof videoPresets[number]): SceneMotion => ({
  sceneId,
  imageAssetIds: [],
  layout: { titlePosition: "top_left", subtitlePosition: "bottom_left" },
  text: {
    titleEntrance: preset.defaults.titleEntrance,
    subtitleEntrance: preset.defaults.subtitleEntrance,
    emphasis: preset.defaults.textEmphasis,
    titleColor: preset.accentColor,
    subtitleColor: "#FFFFFF",
  },
  image: { motion: preset.defaults.imageMotion, transition: preset.defaults.imageTransition },
  scene: { transition: preset.defaults.sceneTransition },
  caption: { animation: preset.defaults.captionAnimation },
});

const arrangeImages = <T extends { assetId: string }[]>(images: T, idsInOrder: string[]): T => {
  const byId = new Map(images.map((image) => [image.assetId, image]));
  const ordered: T[number][] = [];
  const seen = new Set<string>();
  for (const id of idsInOrder) {
    const image = byId.get(id);
    if (image && !seen.has(id)) {
      ordered.push(image);
      seen.add(id);
    }
  }
  for (const image of images) if (!seen.has(image.assetId)) ordered.push(image);
  return ordered as T;
};

export const composeVideo = (input: ComposeRequest) => {
  const preset = videoPresets.find((item) => item.id === input.presetId);
  if (!preset) throw new Error("Video preset not found");
  const motionByScene = new Map(input.motionPlan.scenes.map((item) => [item.sceneId, item]));
  const scenes: unknown[] = [];
  const semanticScenes: Record<string, unknown>[] = [];
  let totalFrames = 0;
  let transitionFramesTotal = 0;

  input.scenes.forEach((scene, sceneIndex) => {
    const motion = motionByScene.get(scene.id) ?? defaultMotion(scene.id, preset);
    const images = arrangeImages(scene.images, motion.imageAssetIds);
    const durationFrames = Math.max(1, Math.ceil((scene.durationMs * defaultFps) / 1000));
    const transitionFrames = sceneIndex < input.scenes.length - 1
      ? Math.min(12, Math.max(1, Math.floor(durationFrames / 5)))
      : 0;
    totalFrames += durationFrames;
    transitionFramesTotal += transitionFrames;
    const elements: JsonVideoElement[] = [];
    const timeline = buildImageTimeline(durationFrames, images.length);
    images.forEach((image, imageIndex) => {
      const timing = timeline[imageIndex];
      elements.push({
        id: `${scene.id}-image-${imageIndex + 1}`,
        type: "image",
        src: image.url,
        from: timing.from,
        durationInFrames: timing.duration,
        position: { x: 960, y: 540, anchor: "center" },
        size: { width: 1920, height: 1080 },
        zIndex: 0,
        opacity: 1,
        animations: imageAnimations(motion.image.motion, timing.duration, timing.fadeIn),
        style: { objectFit: "cover", borderRadius: 0 },
      });
    });
    elements.push(textElement(`${scene.id}-title`, scene.title, durationFrames, motion.layout.titlePosition, motion.text.titleEntrance, motion.text.emphasis, motion.text.titleColor, false, transitionFrames));
    const subtitle = scene.subtitle || scene.cta;
    if (subtitle) {
      elements.push(textElement(`${scene.id}-subtitle`, subtitle, durationFrames, motion.layout.titlePosition, motion.text.subtitleEntrance, "none", motion.text.subtitleColor, true, transitionFrames));
    }
    elements.push({
      id: `${scene.id}-audio`, type: "audio", src: scene.narration.url, from: 0, durationInFrames: durationFrames,
      volume: 1, playbackRate: 1, trimBefore: 0, loop: false, toneFrequency: 1, animations: [],
    });
    const captions = localCaptions(scene.narration.captions, scene.narration.startMs, scene.durationMs);
    if (captions.length > 0) {
      elements.push({
        id: `${scene.id}-captions`, type: "captions", captions, from: 0, durationInFrames: durationFrames,
        position: { x: 960, y: 940, anchor: "center" }, zIndex: 4, opacity: 1, animations: [],
        displayMode: motion.caption.animation === "word-highlight" ? "page" : "sentence",
        combineTokensWithinMilliseconds: 1200,
        animationPreset: motion.caption.animation,
        style: { width: 1720, fontSize: 50, fontFamily: "Arial, sans-serif", fontWeight: 700, lineHeight: 1.2, color: "#FFFFFF", highlightColor: preset.accentColor, shadowColor: "#000000E6", shadowBlur: 12, textAlign: "center", padding: 0 },
      });
    }
    scenes.push({
      id: scene.id,
      durationInFrames: durationFrames,
      backgroundColor: preset.backgroundColor,
      elements,
      ...(transitionFrames > 0 ? { transitionAfter: { type: motion.scene.transition, durationInFrames: transitionFrames } } : {}),
    });
    semanticScenes.push({
      sceneId: scene.id,
      imageAssetIds: images.map((image) => image.assetId),
      narrationAssetId: scene.narration.assetId,
      motion,
      durationMs: scene.durationMs,
    });
  });

  const inputProps: JsonVideoProps = jsonVideoSchema.parse({
    version: CURRENT_JSON_VIDEO_VERSION,
    video: { width: 1920, height: 1080, fps: defaultFps, durationInFrames: totalFrames - transitionFramesTotal, backgroundColor: preset.backgroundColor },
    elements: [],
    scenes,
  });
  return {
    preset: { ...preset, schemaVersion: CURRENT_JSON_VIDEO_VERSION },
    plan: { visualStyle: input.visualStyle, scenes: semanticScenes },
    renderRequest: { compositionId: "JsonVideo", inputProps },
    generatedAt: new Date().toISOString(),
  };
};
