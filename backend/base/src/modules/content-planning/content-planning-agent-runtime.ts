import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callConfiguredStructuredLlm } from '../content/configured-llm.client.js';
import type {
  ContentPlanningCandidate,
  ContentPlanningSession,
  ContentPlanningStrategyDirection,
  ContentPlanningTimelineSegment,
  ContentPlanningStoryboardSegment,
  ContentPlanningDurationSeconds,
} from './content-planning.types.js';

export type PlanningBrief = {
  summary: string;
  hardConstraints: string[];
  candidateDirections: string[];
};

export type PlanningTimeline = {
  strategyId: string;
  segments: ContentPlanningTimelineSegment[];
};

export type PlanningScriptLines = {
  strategyId: string;
  lines: Array<{ segmentId: string; text: string }>;
};

export type PlanningRuntimeContext = {
  session: ContentPlanningSession;
  brief?: PlanningBrief;
  strategies?: ContentPlanningStrategyDirection[];
  timelines?: PlanningTimeline[];
  scripts?: PlanningScriptLines[];
  candidates?: ContentPlanningCandidate[];
  onAuditDelta?: (delta: string) => void;
};

export interface ContentPlanningAgentProvider {
  planner(context: PlanningRuntimeContext): Promise<PlanningBrief>;
  strategy(context: PlanningRuntimeContext): Promise<ContentPlanningStrategyDirection[]>;
  timeline(context: PlanningRuntimeContext): Promise<PlanningTimeline[]>;
  copywriter(context: PlanningRuntimeContext): Promise<PlanningScriptLines[]>;
  visualDirector(context: PlanningRuntimeContext): Promise<ContentPlanningCandidate[]>;
  validator(context: PlanningRuntimeContext & { candidates: ContentPlanningCandidate[] }): Promise<{
    candidates: ContentPlanningCandidate[];
    selectedCandidateId: string;
    summary: string;
  }>;
}

const plannerOutputSchema = z.object({
  auditText: z.string().min(1),
  summary: z.string().min(1),
  hardConstraints: z.array(z.string().min(1)).min(1).max(20),
  candidateDirections: z.array(z.string().min(1)).min(1).max(8),
});

const strategyOutputSchema = z.object({
  auditText: z.string().min(1),
  strategies: z.array(z.object({
    title: z.string().min(1),
    hook: z.string().min(1),
    audienceAngle: z.string().min(1),
    emotionalArc: z.string().min(1),
    summary: z.string().min(1),
    followReferenceStructure: z.boolean(),
    tags: z.array(z.string().min(1)).max(8),
  })).min(1).max(5),
});

const timelineOutputSchema = z.object({
  auditText: z.string().min(1),
  timelines: z.array(z.object({
    strategyId: z.string().min(1),
    segments: z.array(z.object({
      startSecond: z.number().min(0),
      endSecond: z.number().positive(),
      beat: z.string().min(1),
      goal: z.string().min(1),
    })).min(1).max(12),
  })).min(1).max(5),
});

const writerOutputSchema = z.object({
  auditText: z.string().min(1),
  scripts: z.array(z.object({
    strategyId: z.string().min(1),
    lines: z.array(z.object({
      segmentId: z.string().min(1),
      text: z.string(),
    })).min(1).max(12),
  })).min(1).max(5),
});

const storyboardSegmentOutputSchema = z.object({
  startSecond: z.number().min(0),
  endSecond: z.number().positive(),
  title: z.string().min(1),
  visual: z.string().min(1),
  action: z.string().min(1),
  dialogue: z.string(),
  soundEffect: z.string(),
  camera: z.string().min(1),
  lighting: z.string().min(1),
  spaceRelation: z.string().min(1),
  materialRefs: z.array(z.string().min(1)).max(9),
});

const visualDirectorOutputSchema = z.object({
  auditText: z.string().min(1),
  candidates: z.array(z.object({
    strategyId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    hook: z.string().min(1),
    audienceAngle: z.string().min(1),
    tags: z.array(z.string().min(1)).max(8),
    storyboard: z.array(storyboardSegmentOutputSchema).min(1).max(12),
  })).min(1).max(5),
});

const validatorOutputSchema = z.object({
  auditText: z.string().min(1),
  assessments: z.array(z.object({
    candidateId: z.string().min(1),
    score: z.number().min(0).max(100),
    issues: z.array(z.string()),
    repairAdvice: z.string(),
  })).min(1).max(5),
  selectedCandidateId: z.string().min(1),
  summary: z.string().min(1),
});

function durationSegments(durationSeconds: ContentPlanningDurationSeconds, strategyId: string) {
  const firstEnd = durationSeconds === 5 ? 1 : durationSeconds === 10 ? 2 : 3;
  const secondEnd = durationSeconds === 5 ? 3 : durationSeconds === 10 ? 6 : 9;
  return [
    { startSecond: 0, endSecond: firstEnd },
    { startSecond: firstEnd, endSecond: secondEnd },
    { startSecond: secondEnd, endSecond: durationSeconds },
  ].map((range, index) => ({
    id: `${strategyId}-segment-${index + 1}`,
    ...range,
    beat: ['hook', 'proof', 'conversion'][index] || 'support',
    goal: ['stop the scroll', 'show a concrete benefit', 'close with a clear action'][index] || 'support the story',
  }));
}

function materialToken(index: number) {
  return `@image${index + 1}`;
}

function buildStoryboard(
  session: ContentPlanningSession,
  strategy: ContentPlanningStrategyDirection,
  timeline: PlanningTimeline,
  lines: PlanningScriptLines,
) {
  const imageRefs = session.materialBundle.imageMaterials;
  return timeline.segments.map((segment, index): ContentPlanningStoryboardSegment => {
    const line = lines.lines.find((item) => item.segmentId === segment.id)?.text || `${strategy.title} scene ${index + 1}`;
    const refs = imageRefs.length ? [materialToken(index % imageRefs.length)] : [];
    return {
      id: `${strategy.id}-shot-${index + 1}`,
      startSecond: segment.startSecond,
      endSecond: segment.endSecond,
      title: segment.beat,
      visual: `${line}; show the product clearly in ${refs.join(', ') || 'a clean product frame'}`,
      action: index === 0 ? 'Reveal the product immediately' : index === 1 ? 'Demonstrate the key benefit' : 'End on the product and call to action',
      dialogue: session.settings.displayOnly ? '' : line,
      soundEffect: index === 0 ? 'light impact' : 'natural room tone',
      camera: index === 0 ? 'close-up push-in' : index === 1 ? 'medium tracking shot' : 'steady hero shot',
      lighting: 'bright, soft, product-safe lighting',
      spaceRelation: 'product remains the visual anchor',
      materialRefs: refs,
    };
  });
}

function fullScriptFor(storyboard: ContentPlanningStoryboardSegment[]) {
  return storyboard
    .map((segment) => `${segment.startSecond}-${segment.endSecond}s: ${segment.dialogue || segment.visual}`)
    .join('\n');
}

export function buildContentPlanningPrompt(
  session: ContentPlanningSession,
  storyboard: ContentPlanningStoryboardSegment[],
  plan: { title: string; summary: string },
) {
  const spokenLanguage = {
    zh: '中文',
    en: '英文',
    ja: '日文',
    de: '德文',
    fr: '法文',
  }[session.settings.spokenLanguage];
  const requirements = [
    `${session.settings.durationSeconds} 秒`,
    '9:16 竖屏',
    `风格：${session.settings.styleKeywords.join('、') || '干净明亮'}`,
    session.settings.displayOnly ? '仅视觉展示，不生成口播' : `口播语言：${spokenLanguage}`,
    '全程不添加字幕、弹窗文字或屏幕 UI',
    '保持商品颜色、版型、纹理和主体身份稳定',
  ].join('；');
  const parts = [
    `## ${plan.title}`,
    plan.summary,
    '',
    `生成要求：${requirements}。`,
    session.settings.extraInstruction ? `补充要求：${session.settings.extraInstruction}` : '',
    '',
    '逐秒分镜：',
  ];

  storyboard.forEach((segment) => {
    const missingRefs = segment.materialRefs.filter((ref) => !segment.visual.includes(ref));
    const visual = [segment.visual, ...missingRefs].filter(Boolean).join(' ');
    parts.push(
      '',
      `${segment.startSecond}-${segment.endSecond}s｜${segment.title}`,
      `画面：${visual}`,
      segment.action ? `主体动作：${segment.action}` : '',
      segment.camera ? `景别/运镜：${segment.camera}` : '',
      segment.spaceRelation ? `空间关系：${segment.spaceRelation}` : '',
      segment.lighting ? `光线：${segment.lighting}` : '',
      `口播：${segment.dialogue || '无，仅画面展示'}`,
      segment.soundEffect ? `音效与音乐：${segment.soundEffect}` : '',
    );
  });

  return parts.filter((line, index) => line || parts[index - 1] !== '').join('\n').trim();
}

export class DeterministicContentPlanningAgentProvider implements ContentPlanningAgentProvider {
  async planner(context: PlanningRuntimeContext): Promise<PlanningBrief> {
    const { session } = context;
    const material = session.materialBundle.productName || 'the product';
    return {
      summary: `${material} video plan for ${session.settings.businessScene}; ${session.materialBundle.prompt || 'focus on a clear product benefit'}`,
      hardConstraints: [
        `${session.settings.durationSeconds} seconds total`,
        'use uploaded image references when available',
        session.settings.displayOnly ? 'display-only: no spoken dialogue' : `spoken language: ${session.settings.spokenLanguage}`,
        'no subtitles',
      ],
      candidateDirections: ['benefit-first demonstration', 'problem-to-solution proof', 'fast comparison and call to action'],
    };
  }

  async strategy(context: PlanningRuntimeContext): Promise<ContentPlanningStrategyDirection[]> {
    const { session } = context;
    const directions = context.brief?.candidateDirections || ['benefit-first demonstration'];
    const count = Math.max(1, Math.min(3, session.settings.candidateCount));
    return Array.from({ length: count }, (_, index) => ({
      id: `strategy-${index + 1}-${randomUUID().slice(0, 8)}`,
      title: directions[index % directions.length] || `creative direction ${index + 1}`,
      hook: index === 0 ? 'Show the product result before the explanation.' : index === 1 ? 'Start with a familiar problem and resolve it.' : 'Contrast the old way with the product outcome.',
      audienceAngle: index === 0 ? 'busy buyers who want quick proof' : index === 1 ? 'curious buyers with a specific pain point' : 'comparison-oriented buyers',
      emotionalArc: index === 0 ? 'curiosity to confidence' : index === 1 ? 'friction to relief' : 'doubt to preference',
      summary: `A ${directions[index % directions.length] || 'product'} route for ${session.materialBundle.productName || 'the product'}.`,
      followReferenceStructure: Boolean(session.settings.referencePolicy.useBreakdown && session.analysis.viralBreakdown),
      tags: session.settings.styleKeywords.slice(0, 4),
    }));
  }

  async timeline(context: PlanningRuntimeContext): Promise<PlanningTimeline[]> {
    return (context.strategies || []).map((strategy) => ({
      strategyId: strategy.id,
      segments: durationSegments(context.session.settings.durationSeconds, strategy.id),
    }));
  }

  async copywriter(context: PlanningRuntimeContext): Promise<PlanningScriptLines[]> {
    return (context.timelines || []).map((timeline, strategyIndex) => ({
      strategyId: timeline.strategyId,
      lines: timeline.segments.map((segment, index) => ({
        segmentId: segment.id,
        text: context.session.settings.displayOnly
          ? `Visual beat ${index + 1}: make the ${index === 0 ? 'product promise' : index === 1 ? 'benefit' : 'next step'} obvious.`
          : [
            `What if ${context.session.materialBundle.productName || 'this product'} solved the problem in seconds?`,
            'Here is the benefit you can see and feel right away.',
            'Make the next step simple and start today.',
          ][(index + strategyIndex) % 3] || 'See the product in action.',
      })),
    }));
  }

  async visualDirector(context: PlanningRuntimeContext): Promise<ContentPlanningCandidate[]> {
    const strategies = context.strategies || [];
    const timelines = context.timelines || [];
    const scripts = context.scripts || [];
    return strategies.map((strategy) => {
      const timeline = timelines.find((item) => item.strategyId === strategy.id) || { strategyId: strategy.id, segments: [] };
      const lines = scripts.find((item) => item.strategyId === strategy.id) || { strategyId: strategy.id, lines: [] };
      const storyboard = buildStoryboard(context.session, strategy, timeline, lines);
      const fullScript = fullScriptFor(storyboard);
      const prompt = buildContentPlanningPrompt(context.session, storyboard, {
        title: strategy.title,
        summary: strategy.summary,
      });
      const script = {
        id: `script-${strategy.id}`,
        title: strategy.title,
        summary: strategy.summary,
        fullScript,
        prompt,
        durationSeconds: context.session.settings.durationSeconds,
        storyboard,
      };
      return {
        id: `candidate-${strategy.id}`,
        title: strategy.title,
        summary: strategy.summary,
        hook: strategy.hook,
        audienceAngle: strategy.audienceAngle,
        tags: strategy.tags,
        fullScript,
        prompt,
        storyboard,
        score: 0,
        issues: [],
        repairAdvice: '',
        sourceStrategyId: strategy.id,
        script,
      } satisfies ContentPlanningCandidate;
    });
  }

  async validator(context: PlanningRuntimeContext & { candidates: ContentPlanningCandidate[] }) {
    const candidates = context.candidates.map((candidate) => {
      const issues: string[] = [];
      const duration = candidate.storyboard.at(-1)?.endSecond || 0;
      if (duration !== context.session.settings.durationSeconds) {
        issues.push(`storyboard duration must be ${context.session.settings.durationSeconds} seconds`);
      }
      if (!context.session.settings.displayOnly && !candidate.fullScript.trim()) {
        issues.push('spoken script is empty');
      }
      if (context.session.materialBundle.imageMaterials.length && !candidate.storyboard.some((segment) => segment.materialRefs.length)) {
        issues.push('storyboard does not reference an uploaded image');
      }
      return {
        ...candidate,
        score: Math.max(0, 100 - issues.length * 15),
        issues,
        repairAdvice: issues.length ? 'Repair the highlighted constraints before rendering.' : 'Ready to apply to video creation.',
      };
    });
    const selected = [...candidates].sort((left, right) => right.score - left.score)[0];
    return {
      candidates,
      selectedCandidateId: selected?.id || '',
      summary: selected ? `Validated ${candidates.length} candidates; selected ${selected.title} with score ${selected.score}.` : 'No candidate was produced.',
    };
  }
}

class ConfiguredLlmContentPlanningAgentProvider implements ContentPlanningAgentProvider {
  async planner(context: PlanningRuntimeContext): Promise<PlanningBrief> {
    const { parsed } = await callConfiguredStructuredLlm({
      ...planningAuditStreamOptions(context),
      userId: context.session.userId,
      sourceType: 'content_planning_planner',
      sourceId: `${context.session.id}:planner`,
      schema: plannerOutputSchema,
      temperature: 0.35,
      timeoutMs: 180_000,
      system: [
        '你是短视频策划系统的 Planner。',
        '先系统分析商品可见特征、目标人群、使用场景、素材能力、参考视频结构、目标时长和生成参数，再整理为可执行 brief。',
        'hardConstraints 必须覆盖总时长、画面风格、商品真实性、口播语言、无字幕/无屏幕文字、素材完整使用和禁止夸大等约束。总时长必须表述为“精确等于 settings.durationSeconds 秒”，禁止写成“以内”“不超过”或更短时长。',
        'candidateDirections 要给出数量与 candidateCount 一致的差异路线，至少覆盖氛围种草、卖点/痛点、场景/对话或参考结构适配等不同创意机制。',
        '只输出可审计的规划结论，不写逐秒分镜，不泄露隐藏思维链。',
      ].join('\n'),
      user: planningStageInput(context),
    });
    return {
      summary: parsed.summary,
      hardConstraints: parsed.hardConstraints,
      candidateDirections: parsed.candidateDirections,
    };
  }

  async strategy(context: PlanningRuntimeContext): Promise<ContentPlanningStrategyDirection[]> {
    const { parsed } = await callConfiguredStructuredLlm({
      ...planningAuditStreamOptions(context),
      userId: context.session.userId,
      sourceType: 'content_planning_strategy',
      sourceId: `${context.session.id}:strategy`,
      schema: strategyOutputSchema,
      temperature: 0.65,
      timeoutMs: 180_000,
      system: [
        '你是短视频策划系统的 Strategy Agent。',
        '根据 Planner brief 设计真正差异化的创意路线，数量必须等于 candidateCount。',
        '每条路线的总时长必须精确等于 settings.durationSeconds；summary 中出现逐段时间时，第一段从 0 开始，最后一段必须结束于该目标秒数。',
        '每条路线要有不同钩子、受众角度和情绪曲线；有参考视频时遵守是否复刻其结构的设置。',
        '短视频必须在首个镜头建立明确钩子，后续用商品证据承接，结尾完成记忆或转化；禁止只改文案而复用同一创意结构。',
        '当前成片不使用字幕或屏幕文字，不得把弹窗大字、字幕卡、价格贴纸等作为策略核心，信息应通过画面和口播表达。',
      ].join('\n'),
      user: planningStageInput(context),
    });
    return parsed.strategies.slice(0, context.session.settings.candidateCount).map((strategy, index) => ({
      ...strategy,
      id: `strategy-${index + 1}-${randomUUID().slice(0, 8)}`,
    }));
  }

  async timeline(context: PlanningRuntimeContext): Promise<PlanningTimeline[]> {
    const strategies = context.strategies || [];
    const { parsed } = await callConfiguredStructuredLlm({
      ...planningAuditStreamOptions(context),
      userId: context.session.userId,
      sourceType: 'content_planning_timeline',
      sourceId: `${context.session.id}:timeline`,
      schema: timelineOutputSchema,
      temperature: 0.25,
      timeoutMs: 180_000,
      system: [
        '你是短视频策划系统的 Timeline Agent。',
        '为每个 strategyId 生成完整连续的时间轴，第一段必须从 0 开始，最后一段必须结束于 durationSeconds。',
        'targetDurationSeconds/settings.durationSeconds 是唯一时长真值；参考视频 timeRange 和 Strategy summary 中的其他总时长只可参考节奏比例，存在冲突时必须改写并补齐到目标时长。',
        '时间段不可重叠或留空；每段只定义节奏功能和目标，不写详细画面。',
        '5秒视频安排3-5段，10秒安排4-7段，15秒安排5-9段；镜头切分必须服务于钩子、卖点证据和收尾，不为切镜而切镜。',
        'goal 中不得安排字幕、弹窗或屏幕文字；需要表达的信息交给口播或可见商品动作。',
      ].join('\n'),
      user: planningStageInput(context),
    });
    return strategies.map((strategy, strategyIndex) => {
      const output = parsed.timelines.find((timeline) => timeline.strategyId === strategy.id)
        || parsed.timelines[strategyIndex];
      if (!output) {
        throw new Error(`Timeline Agent 未返回策略 ${strategy.id} 的时间轴`);
      }
      const normalizedSegments = normalizePlanningTimelineSegments(
        output.segments,
        context.session.settings.durationSeconds,
      );
      return {
        strategyId: strategy.id,
        segments: normalizedSegments.map((segment, index) => ({
          ...segment,
          id: `${strategy.id}-segment-${index + 1}`,
        })),
      };
    });
  }

  async copywriter(context: PlanningRuntimeContext): Promise<PlanningScriptLines[]> {
    const timelines = context.timelines || [];
    const { parsed } = await callConfiguredStructuredLlm({
      ...planningAuditStreamOptions(context),
      userId: context.session.userId,
      sourceType: 'content_planning_writer',
      sourceId: `${context.session.id}:writer`,
      schema: writerOutputSchema,
      temperature: 0.55,
      timeoutMs: 180_000,
      system: [
        '你是短视频策划系统的 Writer Agent。',
        '严格按每个时间段可说完的字数写口播：中文自然语速按每秒4-5个汉字控制，并在提交前逐段复核；displayOnly=true 时 text 必须为空字符串。',
        '文案要自然、具体、覆盖核心卖点，禁止虚构未提供的功效和数据。',
        '各候选的语气与表达机制必须不同，避免同义改写；短时长优先一句一意，删除无法在镜头内说完的修饰词。',
        'segmentId 必须原样使用输入时间轴中的 id。',
      ].join('\n'),
      user: planningStageInput(context),
    });
    return timelines.map((timeline, timelineIndex) => {
      const output = parsed.scripts.find((script) => script.strategyId === timeline.strategyId)
        || parsed.scripts[timelineIndex];
      if (!output) {
        throw new Error(`Writer Agent 未返回策略 ${timeline.strategyId} 的文案`);
      }
      return {
        strategyId: timeline.strategyId,
        lines: timeline.segments.map((segment, index) => ({
          segmentId: segment.id,
          text: context.session.settings.displayOnly
            ? ''
            : output.lines.find((line) => line.segmentId === segment.id)?.text
              ?? output.lines[index]?.text
              ?? '',
        })),
      };
    });
  }

  async visualDirector(context: PlanningRuntimeContext): Promise<ContentPlanningCandidate[]> {
    const strategies = context.strategies || [];
    const timelines = context.timelines || [];
    const scripts = context.scripts || [];
    const { parsed } = await callConfiguredStructuredLlm({
      ...planningAuditStreamOptions(context),
      userId: context.session.userId,
      sourceType: 'content_planning_visual_director',
      sourceId: `${context.session.id}:visual-director`,
      schema: visualDirectorOutputSchema,
      temperature: 0.5,
      timeoutMs: 240_000,
      system: [
        '你是短视频策划系统的 Visual Director。',
        '把 Strategy、Timeline、Writer 输出合成为逐秒分镜。',
        '每段必须补全画面、主体微动作、运镜、光线与动态光影、空间关系、口播和音效；时间轴必须与输入完全一致。',
        '当前成片全程无字幕、无弹窗大字、无屏幕 UI 文案，禁止在 visual 或 action 中安排任何文字叠加。',
        '使用上传图片时，在 visual 中先自然描述图片可见主体和细节，再在句末内联对应 @imageN；materialRefs 同步填写同一标签，仅供系统校验，不作为分镜展示字段。',
        '不得把平铺图直接虚构为真人上身实拍；需要上身效果时必须明确为基于参考商品外观生成，并保持商品颜色、版型和纹理稳定。',
      ].join('\n'),
      user: planningStageInput(context),
    });
    return strategies.map((strategy, strategyIndex) => {
      const output = parsed.candidates.find((candidate) => candidate.strategyId === strategy.id)
        || parsed.candidates[strategyIndex];
      const timeline = timelines.find((item) => item.strategyId === strategy.id);
      const lines = scripts.find((item) => item.strategyId === strategy.id);
      if (!output || !timeline || !lines) {
        throw new Error(`Visual Director 未返回策略 ${strategy.id} 的完整分镜`);
      }
      const storyboard = timeline.segments.map((segment, index): ContentPlanningStoryboardSegment => {
        const visual = output.storyboard[index];
        if (!visual) {
          throw new Error(`Visual Director 返回的策略 ${strategy.id} 分镜数量不足`);
        }
        return {
          id: `${strategy.id}-shot-${index + 1}`,
          startSecond: segment.startSecond,
          endSecond: segment.endSecond,
          title: visual.title,
          visual: visual.visual,
          action: visual.action,
          dialogue: context.session.settings.displayOnly
            ? ''
            : lines.lines.find((line) => line.segmentId === segment.id)?.text || visual.dialogue,
          soundEffect: visual.soundEffect,
          camera: visual.camera,
          lighting: visual.lighting,
          spaceRelation: visual.spaceRelation,
          materialRefs: validMaterialRefs(visual.materialRefs, context.session.materialBundle.imageMaterials.length),
        };
      });
      const fullScript = fullScriptFor(storyboard);
      const prompt = buildContentPlanningPrompt(context.session, storyboard, {
        title: output.title,
        summary: output.summary,
      });
      const candidateId = `candidate-${strategy.id}`;
      return {
        id: candidateId,
        title: output.title,
        summary: output.summary,
        hook: output.hook,
        audienceAngle: output.audienceAngle,
        tags: output.tags,
        fullScript,
        prompt,
        storyboard,
        score: 0,
        issues: [],
        repairAdvice: '',
        sourceStrategyId: strategy.id,
        script: {
          id: `script-${strategy.id}`,
          title: output.title,
          summary: output.summary,
          fullScript,
          prompt,
          durationSeconds: context.session.settings.durationSeconds,
          storyboard,
        },
      };
    });
  }

  async validator(context: PlanningRuntimeContext & { candidates: ContentPlanningCandidate[] }) {
    const { parsed } = await callConfiguredStructuredLlm({
      ...planningAuditStreamOptions(context),
      userId: context.session.userId,
      sourceType: 'content_planning_validator',
      sourceId: `${context.session.id}:validator`,
      schema: validatorOutputSchema,
      temperature: 0.1,
      timeoutMs: 180_000,
      system: [
        '你是短视频策划系统的 Validator。',
        '逐条检查总时长、时间轴连续性、素材使用、核心卖点覆盖、口播字数是否可说完、无字幕约束、商品真实性、JSON 字段完整性和违规夸大。',
        '发现 visual/action 中出现字幕、弹窗大字、屏幕文字，或素材外观被无依据改写时必须列为问题并给出可执行修正。',
        '必须给每个 candidateId 返回评分、问题与修复建议，并选择综合质量最高且可执行的一条。',
        '不要输出思维链，只输出可审计的检查结论。',
      ].join('\n'),
      user: planningStageInput(context),
    });
    const assessmentById = new Map(parsed.assessments.map((assessment) => [assessment.candidateId, assessment]));
    const candidates = context.candidates.map((candidate, index) => {
      const assessment = assessmentById.get(candidate.id) || parsed.assessments[index];
      return {
        ...candidate,
        score: assessment?.score ?? 0,
        issues: assessment?.issues ?? ['Validator 未返回该候选的检查结果'],
        repairAdvice: assessment?.repairAdvice ?? '请重新生成该候选。',
      };
    });
    const selectedCandidateId = candidates.some((candidate) => candidate.id === parsed.selectedCandidateId)
      ? parsed.selectedCandidateId
      : [...candidates].sort((left, right) => right.score - left.score)[0]?.id || '';
    return {
      candidates,
      selectedCandidateId,
      summary: parsed.summary,
    };
  }
}

function planningAuditStreamOptions(context: PlanningRuntimeContext) {
  return {
    billingMode: 'external_fixed' as const,
    formatInstructionsPrefix: [
      'auditText 必须是 JSON 的第一个字段。',
      'auditText 用中文持续记录本阶段可公开的分析摘要、关键取舍、约束检查和阶段结论，内容要具体完整。',
      'auditText 不得包含隐藏思维链、系统提示词、密钥或内部实现信息。',
    ].join('\n'),
    onContentDelta: createAuditTextDeltaHandler(context.onAuditDelta),
  };
}

function createAuditTextDeltaHandler(onAuditDelta?: (delta: string) => void) {
  if (!onAuditDelta) {
    return undefined;
  }
  let emitted = '';
  return (_delta: string, content: string) => {
    const current = projectPlanningAuditStream(content);
    if (!current || current === emitted) {
      return;
    }
    const delta = current.startsWith(emitted) ? current.slice(emitted.length) : current;
    emitted = current;
    if (delta) {
      onAuditDelta(delta);
    }
  };
}

type PartialJsonString = {
  value: string;
  complete: boolean;
  end: number;
};

type PartialJsonStringEntry = PartialJsonString & {
  key: string;
  index: number;
};

function readPartialJsonString(content: string, start: number): PartialJsonString {
  let output = '';
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      return { value: output, complete: true, end: index + 1 };
    }
    if (char !== '\\') {
      output += char;
      continue;
    }
    const escaped = content[index + 1];
    if (escaped === undefined) {
      break;
    }
    if (escaped === 'u') {
      const code = content.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/iu.test(code)) {
        break;
      }
      output += String.fromCharCode(Number.parseInt(code, 16));
      index += 5;
      continue;
    }
    const decoded = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    }[escaped];
    output += decoded ?? escaped;
    index += 1;
  }
  return { value: output, complete: false, end: content.length };
}

function readPartialJsonStringField(content: string, field: string) {
  const fieldPattern = new RegExp(`${JSON.stringify(field)}\\s*:\\s*"`, 'u');
  const match = fieldPattern.exec(content);
  if (!match) {
    return null;
  }
  return readPartialJsonString(content, (match.index || 0) + match[0].length);
}

export function extractPartialJsonStringField(content: string, field: string) {
  return readPartialJsonStringField(content, field)?.value || '';
}

function decodeJsonStringToken(value: string) {
  return readPartialJsonString(`"${value}"`, 1).value;
}

function extractObjectStringEntries(content: string): PartialJsonStringEntry[] {
  const entries: PartialJsonStringEntry[] = [];
  const fieldPattern = /"((?:\\.|[^"\\])*)"\s*:\s*"/gu;
  let match = fieldPattern.exec(content);
  while (match) {
    const value = readPartialJsonString(content, fieldPattern.lastIndex);
    entries.push({
      ...value,
      key: decodeJsonStringToken(match[1] || ''),
      index: match.index,
    });
    fieldPattern.lastIndex = Math.max(fieldPattern.lastIndex, value.end);
    match = fieldPattern.exec(content);
  }
  return entries;
}

function extractArrayStringEntries(content: string): PartialJsonStringEntry[] {
  const entries: PartialJsonStringEntry[] = [];
  const arrayPattern = /"((?:\\.|[^"\\])*)"\s*:\s*\[/gu;
  let match = arrayPattern.exec(content);
  while (match) {
    const key = decodeJsonStringToken(match[1] || '');
    let depth = 0;
    for (let index = arrayPattern.lastIndex; index < content.length; index += 1) {
      const char = content[index];
      if (char === '"') {
        const value = readPartialJsonString(content, index + 1);
        if (depth === 0) {
          entries.push({ ...value, key, index });
        }
        index = value.end - 1;
        if (!value.complete) {
          break;
        }
        continue;
      }
      if (char === '{' || char === '[') {
        depth += 1;
        continue;
      }
      if (char === '}' || char === ']') {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      }
    }
    match = arrayPattern.exec(content);
  }
  return entries;
}

function planningAuditFieldLabel(field: string) {
  const labels: Record<string, string> = {
    summary: '摘要',
    hardConstraints: '硬性约束',
    candidateDirections: '候选方向',
    title: '方案',
    hook: '开场钩子',
    audienceAngle: '受众角度',
    emotionalArc: '情绪曲线',
    tags: '标签',
    beat: '节奏',
    goal: '镜头目标',
    text: '口播文案',
    visual: '画面',
    action: '主体动作',
    dialogue: '口播',
    soundEffect: '音效与音乐',
    camera: '景别与运镜',
    lighting: '光线',
    spaceRelation: '空间关系',
    materialRefs: '素材引用',
    issues: '校验问题',
    repairAdvice: '修复建议',
  };
  return labels[field] || field;
}

export function projectPlanningAuditStream(content: string) {
  const audit = readPartialJsonStringField(content, 'auditText');
  if (!audit) {
    return '';
  }
  if (!audit.complete) {
    return audit.value;
  }
  const entries = [
    ...extractObjectStringEntries(content),
    ...extractArrayStringEntries(content),
  ]
    .filter((entry) => (
      entry.value
      && entry.key !== 'auditText'
      && !/id$/iu.test(entry.key)
    ))
    .sort((left, right) => left.index - right.index);
  if (!entries.length) {
    return audit.value;
  }
  return [
    audit.value,
    '',
    '阶段结果生成中：',
    ...entries.map((entry) => `${planningAuditFieldLabel(entry.key)}：${entry.value}`),
  ].join('\n');
}

function planningStageInput(context: PlanningRuntimeContext) {
  const { session } = context;
  return JSON.stringify({
    sessionId: session.id,
    targetDurationSeconds: session.settings.durationSeconds,
    product: {
      name: session.materialBundle.productName,
      prompt: session.materialBundle.prompt,
      insights: session.analysis.productInsights,
      materialLabels: session.materialBundle.imageMaterials.map((material, index) => ({
        token: materialToken(index),
        name: material.name,
        mimeType: material.mimeType,
      })),
    },
    referenceVideoBreakdown: session.settings.referencePolicy.useBreakdown ? session.analysis.viralBreakdown : null,
    settings: session.settings,
    brief: context.brief,
    strategies: context.strategies,
    timelines: context.timelines,
    scripts: context.scripts,
    candidates: context.candidates,
  }, null, 2);
}

export function normalizePlanningTimelineSegments<T extends { startSecond: number; endSecond: number }>(
  segments: T[],
  durationSeconds: ContentPlanningDurationSeconds,
) {
  const boundaryEpsilon = 0.001;
  let expectedStart = 0;
  const normalized = segments.map((segment) => {
    if (
      Math.abs(segment.startSecond - expectedStart) > boundaryEpsilon
      || segment.endSecond - segment.startSecond <= boundaryEpsilon
    ) {
      throw new Error('Timeline Agent 返回了不连续或无效的时间段');
    }
    const normalizedSegment = { ...segment, startSecond: expectedStart };
    expectedStart = segment.endSecond;
    return normalizedSegment;
  });
  const lastSegment = normalized.at(-1);
  if (!lastSegment) {
    throw new Error('Timeline Agent 返回了不连续或无效的时间段');
  }
  const durationDelta = durationSeconds - expectedStart;
  const maxEndCorrection = Math.max(0.5, durationSeconds * 0.1);
  if (
    Math.abs(durationDelta) > maxEndCorrection
    || durationSeconds - lastSegment.startSecond <= boundaryEpsilon
  ) {
    throw new Error(`Timeline Agent 返回的总时长不是 ${durationSeconds} 秒`);
  }
  lastSegment.endSecond = durationSeconds;
  return normalized;
}

function validMaterialRefs(refs: string[], materialCount: number) {
  const allowed = new Set(Array.from({ length: materialCount }, (_, index) => materialToken(index)));
  return [...new Set(refs.filter((ref) => allowed.has(ref)))];
}

export function createContentPlanningAgentProvider() {
  return new ConfiguredLlmContentPlanningAgentProvider();
}
