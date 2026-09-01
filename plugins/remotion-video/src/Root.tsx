import { Composition } from "remotion";
import { getJsonVideoDuration, JsonVideo, jsonVideoSchema } from "./JsonVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="JsonVideo"
      component={JsonVideo}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      schema={jsonVideoSchema}
      calculateMetadata={({ props }) => ({
        durationInFrames: getJsonVideoDuration(props),
        fps: props.video.fps,
        width: props.video.width,
        height: props.video.height,
      })}
      defaultProps={{
        version: "2.0",
        video: {
          width: 1920,
          height: 1080,
          fps: 30,
          durationInFrames: 150,
          backgroundColor: "#0F172A",
        },
        elements: [],
      }}
    />
  );
};
