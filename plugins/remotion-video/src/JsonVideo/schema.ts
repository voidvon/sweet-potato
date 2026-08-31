import { z } from "zod";

export const CURRENT_JSON_VIDEO_VERSION = "1.1" as const;

const finiteNumber = z.number().finite();
const frame = z.number().int().min(0);
const duration = z.number().int().min(1);
const cssColor = z.string().min(1).max(64);
const mediaUrl = z
  .url()
  .max(2048)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Media URL must use HTTP or HTTPS",
  });

const easingSchema = z
  .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
  .default("ease-out");

const timedAnimation = {
  from: frame.default(0),
  durationInFrames: duration.default(30),
  easing: easingSchema,
};

export const animationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fade-in"), ...timedAnimation }).strict(),
  z.object({ type: z.literal("fade-out"), ...timedAnimation }).strict(),
  z
    .object({
      type: z.literal("slide-in"),
      ...timedAnimation,
      direction: z.enum(["up", "down", "left", "right"]),
      distance: finiteNumber.min(0).max(4096).default(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("slide-out"),
      ...timedAnimation,
      direction: z.enum(["up", "down", "left", "right"]),
      distance: finiteNumber.min(0).max(4096).default(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("scale-in"),
      ...timedAnimation,
      fromScale: finiteNumber.min(0).max(10).default(0.8),
    })
    .strict(),
  z
    .object({
      type: z.literal("scale-out"),
      ...timedAnimation,
      toScale: finiteNumber.min(0).max(10).default(0.8),
    })
    .strict(),
  z
    .object({
      type: z.literal("rotate-in"),
      ...timedAnimation,
      fromDegrees: finiteNumber.min(-3600).max(3600).default(-15),
    })
    .strict(),
  z
    .object({
      type: z.literal("rotate-out"),
      ...timedAnimation,
      toDegrees: finiteNumber.min(-3600).max(3600).default(15),
    })
    .strict(),
  z
    .object({
      type: z.literal("spring-in"),
      from: frame.default(0),
      durationInFrames: duration.default(30),
      fromScale: finiteNumber.min(0).max(10).default(0.6),
      damping: finiteNumber.min(1).max(1000).default(120),
      mass: finiteNumber.min(0.01).max(100).default(1),
      stiffness: finiteNumber.min(1).max(1000).default(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("blur-in"),
      ...timedAnimation,
      blur: finiteNumber.min(0).max(100).default(16),
    })
    .strict(),
  z
    .object({
      type: z.literal("blur-out"),
      ...timedAnimation,
      blur: finiteNumber.min(0).max(100).default(16),
    })
    .strict(),
  z
    .object({
      type: z.literal("reveal-in"),
      ...timedAnimation,
      direction: z.enum(["up", "down", "left", "right"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("bounce-in"),
      from: frame.default(0),
      durationInFrames: duration.default(30),
      direction: z.enum(["up", "down", "left", "right"]).default("up"),
      distance: finiteNumber.min(0).max(4096).default(120),
      damping: finiteNumber.min(1).max(1000).default(12),
      mass: finiteNumber.min(0.01).max(100).default(0.8),
      stiffness: finiteNumber.min(1).max(1000).default(140),
    })
    .strict(),
  z
    .object({
      type: z.literal("pulse"),
      ...timedAnimation,
      scale: finiteNumber.min(1).max(3).default(1.08),
      cycles: z.number().int().min(1).max(20).default(2),
    })
    .strict(),
  z
    .object({
      type: z.literal("shake"),
      ...timedAnimation,
      amplitude: finiteNumber.min(0).max(500).default(16),
      cycles: z.number().int().min(1).max(50).default(6),
    })
    .strict(),
  z
    .object({
      type: z.literal("float"),
      ...timedAnimation,
      axis: z.enum(["x", "y"]).default("y"),
      distance: finiteNumber.min(0).max(1000).default(16),
      cycles: z.number().int().min(1).max(20).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("ken-burns"),
      ...timedAnimation,
      fromScale: finiteNumber.min(0.1).max(10).default(1),
      toScale: finiteNumber.min(0.1).max(10).default(1.15),
      fromX: finiteNumber.min(-4096).max(4096).default(0),
      toX: finiteNumber.min(-4096).max(4096).default(0),
      fromY: finiteNumber.min(-4096).max(4096).default(0),
      toY: finiteNumber.min(-4096).max(4096).default(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("typewriter"),
      from: frame.default(0),
      durationInFrames: duration.default(30),
      cursor: z.string().max(4).default("|"),
      showCursor: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("count-up"),
      ...timedAnimation,
      fromValue: finiteNumber.default(0),
      toValue: finiteNumber,
      decimals: z.number().int().min(0).max(6).default(0),
      prefix: z.string().max(100).default(""),
      suffix: z.string().max(100).default(""),
      thousandsSeparator: z.boolean().default(true),
    })
    .strict(),
]);

const positionSchema = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
    anchor: z.enum(["center", "top-left"]).default("center"),
  })
  .strict();

const baseTimelineElement = {
  id: z.string().min(1).max(100),
  from: frame.default(0),
  durationInFrames: duration,
};

const baseVisualElement = {
  ...baseTimelineElement,
  position: positionSchema,
  zIndex: z.number().int().min(-1000).max(1000).default(0),
  opacity: finiteNumber.min(0).max(1).default(1),
  animations: z.array(animationSchema).max(12).default([]),
};

const textElementSchema = z
  .object({
    ...baseVisualElement,
    type: z.literal("text"),
    content: z.string().max(5000),
    style: z
      .object({
        width: finiteNumber.min(1).max(4096).default(1400),
        fontSize: finiteNumber.min(1).max(1000).default(80),
        fontFamily: z.string().min(1).max(300).default("Arial, sans-serif"),
        fontWeight: z.number().int().min(100).max(900).default(700),
        lineHeight: finiteNumber.min(0.5).max(5).default(1.2),
        color: cssColor.default("#FFFFFF"),
        textAlign: z.enum(["left", "center", "right"]).default("center"),
        backgroundColor: cssColor.optional(),
        padding: finiteNumber.min(0).max(1000).default(0),
        borderRadius: finiteNumber.min(0).max(4096).default(0),
      })
      .strict()
      .default({
        width: 1400,
        fontSize: 80,
        fontFamily: "Arial, sans-serif",
        fontWeight: 700,
        lineHeight: 1.2,
        color: "#FFFFFF",
        textAlign: "center",
        padding: 0,
        borderRadius: 0,
      }),
  })
  .strict();

const shapeElementSchema = z
  .object({
    ...baseVisualElement,
    type: z.literal("shape"),
    shape: z.enum(["rectangle", "ellipse"]),
    size: z
      .object({
        width: finiteNumber.min(1).max(4096),
        height: finiteNumber.min(1).max(4096),
      })
      .strict(),
    style: z
      .object({
        backgroundColor: cssColor,
        borderColor: cssColor.optional(),
        borderWidth: finiteNumber.min(0).max(200).default(0),
        borderRadius: finiteNumber.min(0).max(4096).default(0),
      })
      .strict(),
  })
  .strict();

const imageElementSchema = z
  .object({
    ...baseVisualElement,
    type: z.literal("image"),
    src: mediaUrl,
    size: z
      .object({
        width: finiteNumber.min(1).max(4096),
        height: finiteNumber.min(1).max(4096),
      })
      .strict(),
    style: z
      .object({
        objectFit: z.enum(["contain", "cover", "fill"]).default("cover"),
        borderRadius: finiteNumber.min(0).max(4096).default(0),
      })
      .strict()
      .default({ objectFit: "cover", borderRadius: 0 }),
  })
  .strict();

const videoElementSchema = z
  .object({
    ...baseVisualElement,
    type: z.literal("video"),
    src: mediaUrl,
    size: z
      .object({
        width: finiteNumber.min(1).max(4096),
        height: finiteNumber.min(1).max(4096),
      })
      .strict(),
    style: z
      .object({
        objectFit: z.enum(["contain", "cover", "fill"]).default("cover"),
        borderRadius: finiteNumber.min(0).max(4096).default(0),
      })
      .strict()
      .default({ objectFit: "cover", borderRadius: 0 }),
    volume: finiteNumber.min(0).max(1).default(1),
    muted: z.boolean().default(false),
    playbackRate: finiteNumber.min(0.1).max(4).default(1),
    trimBefore: frame.default(0),
    loop: z.boolean().default(false),
    toneFrequency: finiteNumber.min(0.01).max(2).default(1),
  })
  .strict();

const audioAnimationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fade-in"), ...timedAnimation }).strict(),
  z.object({ type: z.literal("fade-out"), ...timedAnimation }).strict(),
]);

const audioElementSchema = z
  .object({
    ...baseTimelineElement,
    type: z.literal("audio"),
    src: mediaUrl,
    volume: finiteNumber.min(0).max(1).default(1),
    playbackRate: finiteNumber.min(0.1).max(4).default(1),
    trimBefore: frame.default(0),
    loop: z.boolean().default(false),
    toneFrequency: finiteNumber.min(0.01).max(2).default(1),
    animations: z.array(audioAnimationSchema).max(2).default([]),
  })
  .strict();

const gifElementSchema = z
  .object({
    ...baseVisualElement,
    type: z.literal("gif"),
    src: mediaUrl,
    size: z
      .object({
        width: finiteNumber.min(1).max(4096),
        height: finiteNumber.min(1).max(4096),
      })
      .strict(),
    fit: z.enum(["contain", "cover", "fill"]).default("contain"),
    playbackRate: finiteNumber.min(0.1).max(4).default(1),
    loopBehavior: z
      .enum(["loop", "pause-after-finish", "clear-after-finish"])
      .default("loop"),
    borderRadius: finiteNumber.min(0).max(4096).default(0),
  })
  .strict();

const captionSchema = z
  .object({
    text: z.string().max(1000),
    startMs: finiteNumber.min(0),
    endMs: finiteNumber.min(0),
    timestampMs: finiteNumber.min(0).nullable(),
    confidence: finiteNumber.min(0).max(1).nullable(),
  })
  .strict()
  .refine((caption) => caption.endMs > caption.startMs, {
    message: "Caption endMs must be greater than startMs",
    path: ["endMs"],
  });

const captionsElementSchema = z
  .object({
    ...baseVisualElement,
    type: z.literal("captions"),
    captions: z.array(captionSchema).min(1).max(5000),
    displayMode: z.enum(["page", "sentence"]).default("page"),
    combineTokensWithinMilliseconds: finiteNumber
      .min(100)
      .max(10000)
      .default(1200),
    style: z
      .object({
        width: finiteNumber.min(1).max(4096).default(1600),
        fontSize: finiteNumber.min(1).max(1000).default(72),
        fontFamily: z.string().min(1).max(300).default("Arial, sans-serif"),
        fontWeight: z.number().int().min(100).max(900).default(700),
        lineHeight: finiteNumber.min(0.5).max(5).default(1.2),
        color: cssColor.default("#FFFFFF"),
        highlightColor: cssColor.default("#FACC15"),
        shadowColor: cssColor.default("#000000E6"),
        shadowBlur: finiteNumber.min(0).max(100).default(12),
        textAlign: z.enum(["left", "center", "right"]).default("center"),
        padding: finiteNumber.min(0).max(1000).default(24),
      })
      .strict()
      .default({
        width: 1600,
        fontSize: 72,
        fontFamily: "Arial, sans-serif",
        fontWeight: 700,
        lineHeight: 1.2,
        color: "#FFFFFF",
        highlightColor: "#FACC15",
        shadowColor: "#000000E6",
        shadowBlur: 12,
        textAlign: "center",
        padding: 24,
      }),
  })
  .strict();

export const jsonVideoElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
  videoElementSchema,
  audioElementSchema,
  gifElementSchema,
  captionsElementSchema,
]);

const transitionDuration = z.number().int().min(1).max(18000);
const cardinalTransitionDirection = z.enum([
  "from-left",
  "from-top",
  "from-right",
  "from-bottom",
]);

export const jsonVideoTransitionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("fade"),
      durationInFrames: transitionDuration,
    })
    .strict(),
  z
    .object({
      type: z.literal("slide"),
      durationInFrames: transitionDuration,
      direction: cardinalTransitionDirection.default("from-right"),
    })
    .strict(),
  z
    .object({
      type: z.literal("wipe"),
      durationInFrames: transitionDuration,
      direction: z
        .enum([
          "from-left",
          "from-top-left",
          "from-top",
          "from-top-right",
          "from-right",
          "from-bottom-right",
          "from-bottom",
          "from-bottom-left",
        ])
        .default("from-left"),
    })
    .strict(),
  z
    .object({
      type: z.literal("dissolve"),
      durationInFrames: transitionDuration,
    })
    .strict(),
  z
    .object({
      type: z.literal("clock-wipe"),
      durationInFrames: transitionDuration,
    })
    .strict(),
  z
    .object({
      type: z.literal("iris"),
      durationInFrames: transitionDuration,
    })
    .strict(),
  z
    .object({
      type: z.literal("flip"),
      durationInFrames: transitionDuration,
      direction: cardinalTransitionDirection.default("from-left"),
    })
    .strict(),
]);

export const jsonVideoSceneSchema = z
  .object({
    id: z.string().min(1).max(100),
    durationInFrames: duration.max(18000),
    backgroundColor: cssColor.optional(),
    elements: z.array(jsonVideoElementSchema).max(100).default([]),
    transitionAfter: jsonVideoTransitionSchema.optional(),
  })
  .strict();

export const jsonVideoSchema = z
  .object({
    version: z.enum(["1.0", CURRENT_JSON_VIDEO_VERSION]),
    video: z
      .object({
        width: z.number().int().min(240).max(4096),
        height: z.number().int().min(240).max(4096),
        fps: z.number().int().min(1).max(60),
        durationInFrames: z.number().int().min(1).max(18000),
        backgroundColor: cssColor.default("#000000"),
      })
      .strict(),
    elements: z.array(jsonVideoElementSchema).max(100).default([]),
    scenes: z.array(jsonVideoSceneSchema).min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const validateElements = (
      elements: typeof value.elements,
      timelineDuration: number,
      pathPrefix: (string | number)[],
    ) => {
      const ids = new Set<string>();
      elements.forEach((element, elementIndex) => {
        if (ids.has(element.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate element id: ${element.id}`,
            path: [...pathPrefix, elementIndex, "id"],
          });
        }
        ids.add(element.id);

        if (element.from + element.durationInFrames > timelineDuration) {
          context.addIssue({
            code: "custom",
            message: "Element exceeds its timeline duration",
            path: [...pathPrefix, elementIndex, "durationInFrames"],
          });
        }

        element.animations.forEach((animation, animationIndex) => {
          if (
            animation.from + animation.durationInFrames >
            element.durationInFrames
          ) {
            context.addIssue({
              code: "custom",
              message: "Animation exceeds the element duration",
              path: [...pathPrefix, elementIndex, "animations", animationIndex],
            });
          }

          if (
            (animation.type === "typewriter" ||
              animation.type === "count-up") &&
            element.type !== "text"
          ) {
            context.addIssue({
              code: "custom",
              message: `${animation.type} is only supported on text elements`,
              path: [...pathPrefix, elementIndex, "animations", animationIndex],
            });
          }
        });

        const contentAnimationCount = element.animations.filter(
          (animation) =>
            animation.type === "typewriter" || animation.type === "count-up",
        ).length;
        if (contentAnimationCount > 1) {
          context.addIssue({
            code: "custom",
            message: "A text element can only have one content animation",
            path: [...pathPrefix, elementIndex, "animations"],
          });
        }

        if (element.type === "captions") {
          const elementDurationMs =
            (element.durationInFrames / value.video.fps) * 1000;
          element.captions.forEach((caption, captionIndex) => {
            if (caption.endMs > elementDurationMs) {
              context.addIssue({
                code: "custom",
                message: "Caption exceeds the captions element duration",
                path: [
                  ...pathPrefix,
                  elementIndex,
                  "captions",
                  captionIndex,
                  "endMs",
                ],
              });
            }
          });
        }
      });
    };

    if (!value.scenes) {
      validateElements(value.elements, value.video.durationInFrames, [
        "elements",
      ]);
      return;
    }
    const scenes = value.scenes;

    if (value.version === "1.0") {
      context.addIssue({
        code: "custom",
        message: 'Scenes require DSL version "1.1"',
        path: ["version"],
      });
    }

    validateElements(value.elements, value.video.durationInFrames, [
      "elements",
    ]);

    const sceneIds = new Set<string>();
    scenes.forEach((scene, sceneIndex) => {
      if (sceneIds.has(scene.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate scene id: ${scene.id}`,
          path: ["scenes", sceneIndex, "id"],
        });
      }
      sceneIds.add(scene.id);

      validateElements(scene.elements, scene.durationInFrames, [
        "scenes",
        sceneIndex,
        "elements",
      ]);

      if (sceneIndex === scenes.length - 1 && scene.transitionAfter) {
        context.addIssue({
          code: "custom",
          message: "The final scene cannot have transitionAfter",
          path: ["scenes", sceneIndex, "transitionAfter"],
        });
      }

      const nextScene = scenes[sceneIndex + 1];
      if (
        scene.transitionAfter &&
        nextScene &&
        scene.transitionAfter.durationInFrames >=
          Math.min(scene.durationInFrames, nextScene.durationInFrames)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Transition duration must be shorter than both adjacent scenes",
          path: ["scenes", sceneIndex, "transitionAfter", "durationInFrames"],
        });
      }
    });
  });

export const getJsonVideoDuration = (props: JsonVideoProps): number => {
  if (!props.scenes) {
    return props.video.durationInFrames;
  }

  const sceneDuration = props.scenes.reduce(
    (total, scene) => total + scene.durationInFrames,
    0,
  );
  const transitionOverlap = props.scenes.reduce(
    (total, scene) => total + (scene.transitionAfter?.durationInFrames ?? 0),
    0,
  );

  return sceneDuration - transitionOverlap;
};

export type JsonVideoProps = z.infer<typeof jsonVideoSchema>;
export type JsonVideoElement = z.infer<typeof jsonVideoElementSchema>;
export type JsonVideoAnimation = z.infer<typeof animationSchema>;
export type JsonVideoScene = z.infer<typeof jsonVideoSceneSchema>;
export type JsonVideoTransition = z.infer<typeof jsonVideoTransitionSchema>;
