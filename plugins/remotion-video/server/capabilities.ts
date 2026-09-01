import { CURRENT_JSON_VIDEO_VERSION } from "../src/JsonVideo/schema";
import { remotionMotionCapabilities } from "../src/motion/registry";

export const remotionVideoCapabilities = {
  service: "agent-tool-remotion-video",
  compositionId: "JsonVideo",
  schemaVersion: CURRENT_JSON_VIDEO_VERSION,
  ...remotionMotionCapabilities,
  presets: remotionMotionCapabilities.presets.map((preset) => ({
    ...preset,
    schemaVersion: CURRENT_JSON_VIDEO_VERSION,
  })),
} as const;
