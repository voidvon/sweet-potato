import { AbsoluteFill, Sequence } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { dissolve } from "@remotion/transitions/dissolve";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { iris } from "@remotion/transitions/iris";
import { flip } from "@remotion/transitions/flip";
import { JsonElement } from "./JsonElement";
import type {
  JsonVideoProps,
  JsonVideoScene,
  JsonVideoTransition,
} from "./schema";

const ElementsTimeline: React.FC<{
  elements: JsonVideoScene["elements"];
  backgroundColor: string;
}> = ({ elements, backgroundColor }) => {
  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {elements.map((element) => (
        <Sequence
          key={element.id}
          name={element.id}
          from={element.from}
          durationInFrames={element.durationInFrames}
          layout="none"
        >
          <JsonElement element={element} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const renderSceneTransition = (
  sceneTransition: JsonVideoTransition,
  key: string,
  width: number,
  height: number,
) => {
  const timing = linearTiming({
    durationInFrames: sceneTransition.durationInFrames,
  });

  if (sceneTransition.type === "fade") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={fade()}
        timing={timing}
      />
    );
  }

  if (sceneTransition.type === "slide") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={slide({ direction: sceneTransition.direction })}
        timing={timing}
      />
    );
  }

  if (sceneTransition.type === "wipe") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={wipe({ direction: sceneTransition.direction })}
        timing={timing}
      />
    );
  }

  if (sceneTransition.type === "dissolve") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={dissolve({})}
        timing={timing}
      />
    );
  }

  if (sceneTransition.type === "clock-wipe") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={clockWipe({ width, height })}
        timing={timing}
      />
    );
  }

  if (sceneTransition.type === "iris") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={iris({ width, height })}
        timing={timing}
      />
    );
  }

  return (
    <TransitionSeries.Transition
      key={key}
      presentation={flip({ direction: sceneTransition.direction })}
      timing={timing}
    />
  );
};

export const JsonVideo: React.FC<JsonVideoProps> = ({
  video,
  elements,
  scenes,
}) => {
  if (!scenes) {
    return (
      <ElementsTimeline
        elements={elements}
        backgroundColor={video.backgroundColor}
      />
    );
  }

  return (
    <AbsoluteFill>
      <TransitionSeries>
        {scenes.flatMap((scene) => {
        const timeline = [
          <TransitionSeries.Sequence
            key={`scene-${scene.id}`}
            name={scene.id}
            durationInFrames={scene.durationInFrames}
          >
            <ElementsTimeline
              elements={scene.elements}
              backgroundColor={scene.backgroundColor ?? video.backgroundColor}
            />
          </TransitionSeries.Sequence>,
        ];

        if (scene.transitionAfter) {
          timeline.push(
            renderSceneTransition(
              scene.transitionAfter,
              `transition-after-${scene.id}`,
              video.width,
              video.height,
            ),
          );
        }

        return timeline;
        })}
      </TransitionSeries>
      {elements.length > 0 && (
        <ElementsTimeline elements={elements} backgroundColor="transparent" />
      )}
    </AbsoluteFill>
  );
};

export { getJsonVideoDuration, jsonVideoSchema } from "./schema";
export type { JsonVideoProps } from "./schema";
