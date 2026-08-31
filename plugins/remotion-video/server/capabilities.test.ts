import { describe, expect, test } from "bun:test";
import { animationSchema, jsonVideoElementSchema, jsonVideoTransitionSchema } from "../src/JsonVideo/schema";
import { remotionVideoCapabilities } from "./capabilities";

describe("Remotion video capabilities", () => {
  test("declares every type registered by the JsonVideo schema", () => {
    const animationTypes = animationSchema.options.map(
      (option) => option.shape.type.value,
    );
    const elementTypes = jsonVideoElementSchema.options.map(
      (option) => option.shape.type.value,
    );
    const transitionTypes = jsonVideoTransitionSchema.options.map(
      (option) => option.shape.type.value,
    );
    expect([...remotionVideoCapabilities.animationTypes].sort()).toEqual(animationTypes.sort());
    expect([...remotionVideoCapabilities.elementTypes].sort()).toEqual(elementTypes.sort());
    expect([...remotionVideoCapabilities.transitionTypes].sort()).toEqual(transitionTypes.sort());
  });

  test("every declared animation is accepted by the JsonVideo schema", () => {
    const examples: Record<string, Record<string, unknown>> = {
      "slide-in": { direction: "up" },
      "slide-out": { direction: "down" },
      "reveal-in": { direction: "left" },
      "bounce-in": {},
      "scale-in": {},
      "scale-out": {},
      "rotate-in": {},
      "rotate-out": {},
      "spring-in": {},
      "blur-in": {},
      "blur-out": {},
      "fade-in": {},
      "fade-out": {},
      pulse: {},
      shake: {},
      float: {},
      "ken-burns": {},
      typewriter: {},
      "count-up": { toValue: 100 },
    };
    for (const type of remotionVideoCapabilities.animationTypes) {
      expect(animationSchema.safeParse({ type, ...examples[type] }).success).toBe(true);
    }
  });

  test("declared element and transition types match the schema", () => {
    const elementExamples: Record<string, Record<string, unknown>> = {
      text: { content: "Title", position: { x: 0, y: 0 }, durationInFrames: 30 },
      shape: { shape: "rectangle", size: { width: 10, height: 10 }, style: { backgroundColor: "#000" }, position: { x: 0, y: 0 }, durationInFrames: 30 },
      image: { src: "https://example.com/image.png", size: { width: 10, height: 10 }, position: { x: 0, y: 0 }, durationInFrames: 30 },
      video: { src: "https://example.com/video.mp4", size: { width: 10, height: 10 }, position: { x: 0, y: 0 }, durationInFrames: 30 },
      audio: { src: "https://example.com/audio.mp3", durationInFrames: 30 },
      gif: { src: "https://example.com/image.gif", size: { width: 10, height: 10 }, position: { x: 0, y: 0 }, durationInFrames: 30 },
      captions: { captions: [{ text: "Hi", startMs: 0, endMs: 500, timestampMs: null, confidence: null }], position: { x: 0, y: 0 }, durationInFrames: 30 },
    };
    for (const type of remotionVideoCapabilities.elementTypes) {
      expect(jsonVideoElementSchema.safeParse({ id: type, type, ...elementExamples[type] }).success).toBe(true);
    }
    for (const type of remotionVideoCapabilities.transitionTypes) {
      expect(jsonVideoTransitionSchema.safeParse({ type, durationInFrames: 10 }).success).toBe(true);
    }
  });
});
