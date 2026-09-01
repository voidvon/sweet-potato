import { describe, expect, test } from "bun:test";
import { getJsonVideoDuration, jsonVideoSchema } from "./schema";

const validVideo = {
  version: "2.0" as const,
  video: {
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 150,
    backgroundColor: "#000000",
  },
  elements: [
    {
      id: "title",
      type: "text" as const,
      content: "Hello",
      from: 0,
      durationInFrames: 150,
      position: { x: 960, y: 540, anchor: "center" as const },
      animations: [{ type: "fade-in" as const, durationInFrames: 20 }],
    },
  ],
};

describe("jsonVideoSchema", () => {
  test("adds safe defaults to a valid video", () => {
    const parsed = jsonVideoSchema.parse(validVideo);
    const element = parsed.elements[0];
    if (element.type !== "text") throw new Error("Expected a text element");

    expect(element.opacity).toBe(1);
    expect(element.zIndex).toBe(0);
    expect(element.animations[0].from).toBe(0);
  });

  test("rejects duplicate element ids", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [validVideo.elements[0], validVideo.elements[0]],
    });

    expect(parsed.success).toBe(false);
  });

  test("rejects animations extending past their element", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [
        {
          ...validVideo.elements[0],
          durationInFrames: 30,
          animations: [{ type: "fade-out", from: 20, durationInFrames: 20 }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  test("accepts video, audio, gif and official caption JSON", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [
        {
          id: "video",
          type: "video",
          src: "https://example.com/video.mp4",
          durationInFrames: 150,
          position: { x: 960, y: 540 },
          size: { width: 1920, height: 1080 },
        },
        {
          id: "audio",
          type: "audio",
          src: "https://example.com/audio.mp3",
          durationInFrames: 150,
          animations: [{ type: "fade-in", durationInFrames: 30 }],
        },
        {
          id: "gif",
          type: "gif",
          src: "https://example.com/animation.gif",
          durationInFrames: 150,
          position: { x: 960, y: 540 },
          size: { width: 500, height: 500 },
        },
        {
          id: "captions",
          type: "captions",
          durationInFrames: 150,
          position: { x: 960, y: 900 },
          captions: [
            {
              text: " Hello",
              startMs: 0,
              endMs: 500,
              timestampMs: 0,
              confidence: 1,
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects captions extending past their element", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [
        {
          id: "captions",
          type: "captions",
          durationInFrames: 30,
          position: { x: 960, y: 900 },
          captions: [
            {
              text: " Too long",
              startMs: 0,
              endMs: 2000,
              timestampMs: null,
              confidence: null,
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  test("accepts scenes and subtracts transition overlap from duration", () => {
    const parsed = jsonVideoSchema.parse({
      ...validVideo,
      version: "2.0",
      elements: [],
      scenes: [
        {
          id: "intro",
          durationInFrames: 90,
          elements: [
            {
              ...validVideo.elements[0],
              durationInFrames: 90,
            },
          ],
          transitionAfter: { type: "fade", durationInFrames: 15 },
        },
        {
          id: "main",
          durationInFrames: 120,
          elements: [],
        },
      ],
    });

    expect(getJsonVideoDuration(parsed)).toBe(195);
  });

  test("accepts global narration and captions over scenes", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      version: "2.0",
      video: { ...validVideo.video, durationInFrames: 195 },
      elements: [
        {
          id: "narration",
          type: "audio",
          src: "https://example.com/narration.wav",
          durationInFrames: 195,
        },
        {
          id: "captions",
          type: "captions",
          durationInFrames: 195,
          position: { x: 640, y: 650 },
          captions: [
            {
              text: "全局字幕",
              startMs: 0,
              endMs: 1000,
              timestampMs: 0,
              confidence: 1,
            },
          ],
        },
      ],
      scenes: [
        {
          id: "intro",
          durationInFrames: 90,
          transitionAfter: { type: "fade", durationInFrames: 15 },
        },
        { id: "main", durationInFrames: 120 },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects a transition after the final scene", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      version: "2.0",
      elements: [],
      scenes: [
        {
          id: "only",
          durationInFrames: 90,
          transitionAfter: { type: "wipe", durationInFrames: 15 },
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  test("rejects transitions as long as an adjacent scene", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      version: "2.0",
      elements: [],
      scenes: [
        {
          id: "short",
          durationInFrames: 15,
          transitionAfter: { type: "slide", durationInFrames: 15 },
        },
        { id: "next", durationInFrames: 30 },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  test("rejects an element extending past its scene", () => {
    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      version: "2.0",
      elements: [],
      scenes: [
        {
          id: "intro",
          durationInFrames: 60,
          elements: [
            {
              ...validVideo.elements[0],
              from: 10,
              durationInFrames: 60,
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  test("accepts the marketing animation set on text", () => {
    const parsed = jsonVideoSchema.parse({
      ...validVideo,
      elements: [
        {
          ...validVideo.elements[0],
          animations: [
            { type: "blur-in" },
            { type: "blur-out", from: 120 },
            { type: "reveal-in", direction: "left" },
            { type: "bounce-in" },
            { type: "pulse" },
            { type: "shake" },
            { type: "float" },
            { type: "ken-burns" },
            { type: "typewriter" },
            { type: "shine-in" },
          ],
        },
      ],
    });

    const element = parsed.elements[0];
    expect(element.animations).toHaveLength(10);
    expect(element.animations[0]).toMatchObject({
      type: "blur-in",
      blur: 16,
    });
  });

  test("accepts content animations on text and rejects them elsewhere", () => {
    const countUp = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [
        {
          ...validVideo.elements[0],
          animations: [{ type: "count-up", toValue: 10000, suffix: "+" }],
        },
      ],
    });
    const charBounce = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [
        {
          ...validVideo.elements[0],
          animations: [{ type: "char-bounce-in" }],
        },
      ],
    });
    const invalidImage = jsonVideoSchema.safeParse({
      ...validVideo,
      elements: [
        {
          id: "image",
          type: "image",
          src: "https://example.com/image.png",
          durationInFrames: 150,
          position: { x: 960, y: 540 },
          size: { width: 400, height: 300 },
          animations: [{ type: "char-bounce-in" }],
        },
      ],
    });

    expect(countUp.success).toBe(true);
    expect(charBounce.success).toBe(true);
    expect(invalidImage.success).toBe(false);
  });

  test("accepts official marketing scene transitions", () => {
    const transitionTypes = ["dissolve", "clock-wipe", "iris"] as const;
    const scenes: Array<Record<string, unknown>> = transitionTypes.map(
      (type, index) => ({
        id: `scene-${index}`,
        durationInFrames: 45,
        transitionAfter: { type, durationInFrames: 10 },
      }),
    );
    scenes.push({
      id: "scene-3",
      durationInFrames: 45,
      transitionAfter: {
        type: "flip",
        durationInFrames: 10,
        direction: "from-bottom",
      },
    });

    const parsed = jsonVideoSchema.safeParse({
      ...validVideo,
      version: "2.0",
      elements: [],
      scenes: [...scenes, { id: "scene-4", durationInFrames: 45 }],
    });

    expect(parsed.success).toBe(true);
  });
});
