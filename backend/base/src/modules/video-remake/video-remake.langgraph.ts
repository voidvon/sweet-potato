import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { defaultVideoRemakeNodeAdapters, type VideoRemakeNodeAdapters, type VideoRemakeNodeContext } from './video-remake.node-adapters.js';

const VideoRemakeGraphState = Annotation.Root({
  context: Annotation<VideoRemakeNodeContext>(),
  vod: Annotation<Record<string, unknown> | undefined>(),
  audio: Annotation<Record<string, unknown> | undefined>(),
  visual: Annotation<Record<string, unknown> | undefined>(),
  pip: Annotation<Record<string, unknown> | undefined>(),
  normalized: Annotation<Partial<Record<string, unknown>> | undefined>(),
});

type VideoRemakeGraphStateValue = typeof VideoRemakeGraphState.State;

let compiledAnalysisGraph: ReturnType<ReturnType<typeof createVideoRemakeAnalysisGraph>['compile']> | null = null;

function createVideoRemakeAnalysisGraph(adapters: VideoRemakeNodeAdapters) {
  return new StateGraph(VideoRemakeGraphState)
    .addNode('upload_to_vod', async (state: VideoRemakeGraphStateValue) => ({
      vod: await adapters.uploadToVod(state.context),
    }))
    .addNode('analyze_audio', async (state: VideoRemakeGraphStateValue) => ({
      audio: await adapters.analyzeAudio(state.context),
    }))
    .addNode('analyze_visual', async (state: VideoRemakeGraphStateValue) => ({
      visual: await adapters.analyzeVisual(state.context),
    }))
    .addNode('analyze_pip', async (state: VideoRemakeGraphStateValue) => ({
      pip: await adapters.analyzePip(state.context),
    }))
    .addNode('director_normalize', async (state: VideoRemakeGraphStateValue) => {
      const vod = state.vod || {};
      const audio = state.audio || {};
      const visual = state.visual || {};
      const pip = state.pip || {};
      state.context.workflow.runtime.vod = vod;
      state.context.workflow.runtime.analyses = {
        audio,
        visual,
        pip,
      };
      state.context.onUnderstandingComplete?.({ vod, audio, visual, pip });
      return {
        normalized: await adapters.directorNormalize(state.context),
      };
    })
    .addEdge(START, 'upload_to_vod')
    .addEdge('upload_to_vod', 'analyze_audio')
    .addEdge('upload_to_vod', 'analyze_visual')
    .addEdge('upload_to_vod', 'analyze_pip')
    .addEdge(['analyze_audio', 'analyze_visual', 'analyze_pip'], 'director_normalize')
    .addEdge('director_normalize', END);
}

export async function runVideoRemakeAnalysisGraph(
  context: VideoRemakeNodeContext,
  adapters = defaultVideoRemakeNodeAdapters,
) {
  if (!compiledAnalysisGraph || adapters !== defaultVideoRemakeNodeAdapters) {
    compiledAnalysisGraph = createVideoRemakeAnalysisGraph(adapters).compile();
  }
  const result = await compiledAnalysisGraph.invoke({ context });
  return {
    vod: result.vod || {},
    audio: result.audio || {},
    visual: result.visual || {},
    pip: result.pip || {},
    normalized: result.normalized || {},
    engine: {
      name: 'langgraph',
      package: '@langchain/langgraph',
      graph: 'video_remake_analysis_graph',
      nodes: ['upload_to_vod', 'analyze_audio', 'analyze_visual', 'analyze_pip', 'director_normalize'],
      topology: 'upload_to_vod -> [analyze_audio, analyze_visual, analyze_pip] -> director_normalize',
    },
  };
}
