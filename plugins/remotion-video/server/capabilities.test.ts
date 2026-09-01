/* eslint-disable @remotion/non-pure-animation -- These are server contract fixtures, not rendered animation code. */
import { describe, expect, test } from "bun:test";
import { composeRequestSchema, composeVideo } from "./compose";
import { remotionVideoCapabilities } from "./capabilities";

describe("Remotion video capabilities", () => {
  test("exposes only categorized JsonVideo 2.0 motion capabilities", () => {
    expect(remotionVideoCapabilities.schemaVersion).toBe("2.0");
    expect(Object.keys(remotionVideoCapabilities.motion).sort()).toEqual([
      "captionAnimation",
      "imageMotion",
      "imageTransition",
      "sceneTransition",
      "textEmphasis",
      "textEntrance",
    ]);
    expect("animationTypes" in remotionVideoCapabilities).toBe(false);
    expect("transitionTypes" in remotionVideoCapabilities).toBe(false);
    expect(remotionVideoCapabilities.presets.every((preset) => preset.schemaVersion === "2.0")).toBe(true);
  });

  test("compose contract accepts categorized motion and emits JsonVideo 2.0", () => {
    const input = composeRequestSchema.parse({
      presetId: "clean-marketing",
      visualStyle: "clean",
      scenes: [{
        id: "scene-1",
        title: "核心卖点",
        subtitle: "稳定可靠",
        cta: "",
        durationMs: 4000,
        images: [{ assetId: "image-1", url: "https://example.com/image.png" }],
        narration: {
          assetId: "audio-1",
          url: "https://example.com/audio.mp3",
          startMs: 0,
          captions: [{ text: "稳定可靠", startMs: 0, endMs: 1500, timestampMs: null, confidence: null }],
        },
      }],
      motionPlan: { scenes: [{
        sceneId: "scene-1",
        imageAssetIds: ["image-1"],
        layout: { titlePosition: "top_left", subtitlePosition: "top_left" },
        text: { titleEntrance: "blur", subtitleEntrance: "fade", emphasis: "shine" },
        image: { motion: "ken-burns", transition: "crossfade" },
        scene: { transition: "dissolve" },
        caption: { animation: "fade" },
      }] },
    });
    const result = composeVideo(input);
    expect(result.renderRequest.inputProps.version).toBe("2.0");
    expect(result.renderRequest.inputProps.scenes).toHaveLength(1);
    const elements = result.renderRequest.inputProps.scenes?.[0].elements ?? [];
    const title = elements.find((element) => element.id === "scene-1-title");
    const subtitle = elements.find((element) => element.id === "scene-1-subtitle");
    const captions = elements.find((element) => element.id === "scene-1-captions");
    expect(title?.type).toBe("text");
    expect(subtitle?.type).toBe("text");
    if (title?.type !== "text" || subtitle?.type !== "text") {
      throw new Error("Expected title and subtitle text elements");
    }
    expect(title.position.y).not.toBe(subtitle.position.y);
    expect(captions?.type === "captions" ? captions.animationPreset : null).toBe("fade");
  });

  test("compose defaults keep multi-image coverage continuous", () => {
    const input = composeRequestSchema.parse({
      presetId: "dynamic-promo",
      visualStyle: "energetic",
      scenes: [{
        id: "scene-1",
        title: "新品上市",
        subtitle: "立即体验",
        cta: "",
        durationMs: 4000,
        images: [
          { assetId: "image-1", url: "https://example.com/one.png" },
          { assetId: "image-2", url: "https://example.com/two.png" },
        ],
        narration: {
          assetId: "audio-1",
          url: "https://example.com/audio.mp3",
          startMs: 0,
          captions: [],
        },
      }],
      motionPlan: { scenes: [] },
    });
    const result = composeVideo(input);
    const scene = result.renderRequest.inputProps.scenes?.[0];
    expect(scene).toBeDefined();
    if (!scene) throw new Error("Expected a composed scene");
    const images = scene.elements.filter((element) => element.type === "image");
    expect(images).toHaveLength(2);
    expect(images[1].from).toBeLessThan(images[0].durationInFrames);
    expect(images[1].from + images[1].durationInFrames).toBe(scene.durationInFrames);
    expect(images.every((image) => image.size.width === 1920 && image.size.height === 1080)).toBe(true);
    expect(images.every((image) => image.animations.some((animation) =>
      animation.type === "scale-in" && animation.fromScale >= 1
    ))).toBe(true);
  });
});
