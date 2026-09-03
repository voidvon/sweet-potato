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
    expect(remotionVideoCapabilities.motion.imageTransition.map(({ id }) => id)).toEqual(["crossfade"]);
    expect(remotionVideoCapabilities.motion.sceneTransition.map(({ id }) => id)).not.toContain("dissolve");
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
          playbackRate: 1.5,
          captions: [{ text: "，稳定可靠并且可以显著提升团队日常工作的处理效率和交付质量", startMs: 0, endMs: 3000, timestampMs: null, confidence: null }],
        },
      }, {
        id: "scene-2",
        title: "立即体验",
        subtitle: "开启高效工作",
        cta: "",
        durationMs: 3000,
        images: [{ assetId: "image-2", url: "https://example.com/image-2.png" }],
        narration: {
          assetId: "audio-2",
		  url: "https://example.com/audio.mp3",
          startMs: 4000,
		  sourceStartMs: 4000,
          captions: [],
        },
      }],
      motionPlan: { scenes: [{
        sceneId: "scene-1",
        imageAssetIds: ["image-1"],
        layout: { titlePosition: "top_left", subtitlePosition: "bottom_right" },
        text: { titleEntrance: "blur", subtitleEntrance: "fade", emphasis: "shine", titleColor: "#FFF2A8", subtitleColor: "#102A43" },
        image: { motion: "ken-burns", transition: "crossfade" },
        scene: { transition: "fade" },
        caption: { animation: "fade" },
      }, {
        sceneId: "scene-2",
        imageAssetIds: ["image-2"],
        layout: { titlePosition: "top_left", subtitlePosition: "top_left" },
        text: { titleEntrance: "fade", subtitleEntrance: "fade", emphasis: "none", titleColor: "#FFFFFF", subtitleColor: "#D9EAF7" },
        image: { motion: "ken-burns", transition: "crossfade" },
        scene: { transition: "fade" },
        caption: { animation: "fade" },
      }] },
    });
    const result = composeVideo(input);
    expect(result.renderRequest.inputProps.version).toBe("2.0");
    expect(result.renderRequest.inputProps.scenes).toHaveLength(2);
    const elements = result.renderRequest.inputProps.scenes?.[0].elements ?? [];
    const title = elements.find((element) => element.id === "scene-1-title");
    const subtitle = elements.find((element) => element.id === "scene-1-subtitle");
    const captions = elements.find((element) => element.id === "scene-1-captions");
    const audio = elements.find((element) => element.id === "scene-1-audio");
    expect(title?.type).toBe("text");
    expect(subtitle?.type).toBe("text");
    if (title?.type !== "text" || subtitle?.type !== "text") {
      throw new Error("Expected title and subtitle text elements");
    }
    expect(title.position.y).not.toBe(subtitle.position.y);
    expect(title.position.x).toBe(subtitle.position.x);
    expect(title.style.color).toBe("#FFF2A8");
    expect(subtitle.style.color).toBe("#102A43");
    expect(elements.some((element) => element.id === "scene-1-overlay")).toBe(false);
    expect(captions?.type === "captions" ? captions.animationPreset : null).toBe("fade");
    expect(captions?.type === "captions" ? captions.displayMode : null).toBe("sentence");
    expect(captions?.type === "captions" ? captions.style.width : 0).toBeLessThanOrEqual(1920 * 0.8);
    expect(audio?.type === "audio" ? audio.playbackRate : 0).toBe(1.5);
	const secondAudio = result.renderRequest.inputProps.scenes?.[1].elements.find(
	  (element) => element.id === "scene-2-audio",
	);
	expect(secondAudio?.type === "audio" ? secondAudio.trimBefore : 0).toBe(120);
    const firstScene = result.renderRequest.inputProps.scenes?.[0];
    expect(firstScene?.transitionAfter).toBeDefined();
	expect(firstScene && audio?.type === "audio"
      ? firstScene.durationInFrames - firstScene.transitionAfter!.durationInFrames - audio.durationInFrames
	  : 0).toBe(0);
    expect(captions?.type === "captions" ? captions.captions.length : 0).toBeGreaterThan(1);
    expect(captions?.type === "captions" ? captions.captions.every((caption) => Array.from(caption.text).length <= 18) : false).toBe(true);
    expect(captions?.type === "captions" ? captions.captions.every((caption) => !/^\p{P}/u.test(caption.text)) : false).toBe(true);
    const image = elements.find((element) => element.type === "image");
    expect(image?.animations.some((animation) =>
      animation.type === "ken-burns" && animation.easing === "linear"
    )).toBe(true);
    expect(title.animations.some((animation) =>
      animation.type === "fade-out"
      && animation.from + animation.durationInFrames === title.durationInFrames
    )).toBe(true);
    expect(title.animations.some((animation) =>
      animation.type === "shine-in"
      && animation.easing === "linear"
      && animation.durationInFrames > 30
    )).toBe(true);
    const finalTitle = result.renderRequest.inputProps.scenes?.[1].elements.find(
      (element) => element.id === "scene-2-title",
    );
    expect(finalTitle?.animations.some((animation) => animation.type === "fade-out")).toBe(false);
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
      animation.type === "scale-in"
      && animation.fromScale >= 1
      && animation.easing === "linear"
      && animation.durationInFrames === image.durationInFrames
    ))).toBe(true);
  });
});
