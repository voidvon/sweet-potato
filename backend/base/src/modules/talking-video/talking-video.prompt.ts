import { z } from 'zod';

export type TalkingVideoPromptMedia = {
  assetId?: string;
  durationSeconds?: number;
  filePath: string;
  filename: string;
  mimeType: string;
  updatedAt?: string;
};

export type TalkingVideoPromptImage = TalkingVideoPromptMedia & {
  role: 'model' | 'product' | 'background' | 'detail';
};

export const talkingVideoRoleLabels: Record<TalkingVideoPromptImage['role'], string> = {
  model: '模特',
  product: '产品',
  background: '背景',
  detail: '细节',
};

export function talkingVideoMaterialRoleRules(images: Array<Pick<TalkingVideoPromptImage, 'role'>>) {
  const roles = new Set(images.map((image) => image.role));
  return [
    '图片素材必须严格按角色隔离使用，任何图片中不属于该角色的信息都视为无效，不得跨角色借用。',
    '模特图只决定出镜人物的身份和人物本身的稳定外观；必须忽略图中的背景、空间、家具、物品、产品、文字、水印、光线、色调和构图，也不得把模特图里的服装或手持物自动当作产品。',
    '产品图只决定商品主体、外观、颜色、材质和包装；必须忽略图中的人物、背景、空间、光线和构图。',
    '背景图只决定环境、空间关系、陈设和环境光；必须忽略图中的人物、产品、服装和手持物。',
    '细节图只补充其对应主体的局部纹理、结构或特写信息；不得用来决定人物身份、产品主体或完整场景。',
    !roles.has('background')
      ? '本次未提供背景图：不得从模特图、产品图或细节图提取、沿用或推断背景；场景只能依据口播主题和参考视频结构独立设计，并明确标注为独立场景设计。'
      : '本次已提供背景图：环境只能以背景图为视觉参考，不得改用其他角色图片中的背景。',
    !roles.has('product')
      ? '本次未提供产品图：不得把模特图、背景图或细节图中的物品识别为需要展示的产品。'
      : '本次已提供产品图：商品外观只能以产品图为视觉参考。',
  ];
}

export const talkingVideoAnalysisSchema = z.object({
  durationSeconds: z.number().positive(),
  summary: z.string().min(1),
  visualStyle: z.string().min(1),
  finalPrompt: z.string().min(1),
  presentationLayout: z.object({
    type: z.enum(['full_screen_presenter', 'picture_in_picture', 'voice_over', 'mixed']),
    mainVisualRole: z.string().min(1),
    presenterPlacement: z.string(),
    persistence: z.string().min(1),
  }),
  videoStructure: z.object({
    isContinuousTake: z.boolean(),
    shotBoundaryReason: z.string().min(1),
  }),
  presenter: z.object({
    identity: z.string(),
    expressionStyle: z.string(),
    performanceStyle: z.string(),
  }),
  shots: z.array(z.object({
    startSecond: z.number().min(0),
    endSecond: z.number().positive(),
    shotSize: z.string().min(1),
    visual: z.string().min(1),
    sourceScreenText: z.string().optional(),
    dialogue: z.string(),
    performance: z.string().min(1),
    shootingNotes: z.string().min(1),
  })).min(1).max(30),
  imageReferences: z.array(z.object({
    imageIndex: z.number().int().positive(),
    role: z.enum(['model', 'product', 'background', 'detail']),
    usableTraits: z.string().min(1),
  })),
}).superRefine((analysis, context) => {
  const epsilon = 0.05;
  if (Math.abs(analysis.shots[0]!.startSecond) > epsilon) {
    context.addIssue({ code: 'custom', path: ['shots', 0, 'startSecond'], message: '时间轴必须从 0 秒开始' });
  }
  analysis.shots.forEach((shot, index) => {
    if (shot.endSecond <= shot.startSecond) {
      context.addIssue({ code: 'custom', path: ['shots', index, 'endSecond'], message: '镜号结束时间必须晚于开始时间' });
    }
    if (index > 0 && Math.abs(shot.startSecond - analysis.shots[index - 1]!.endSecond) > epsilon) {
      context.addIssue({ code: 'custom', path: ['shots', index, 'startSecond'], message: '镜号时间轴必须连续且不能重叠' });
    }
    const repeatedParallelClauses = shot.dialogue.match(/在所有(?:的)?/gu)?.length || 0;
    const spokenSentences = shot.dialogue.split(/[。！？；]+/u).filter((part) => part.trim()).length;
    if (repeatedParallelClauses > 1 || spokenSentences > 1) {
      context.addIssue({
        code: 'custom',
        path: ['shots', index, 'dialogue'],
        message: '一个镜号只能承载一个完整观点或一句独立口播，请按语义和时间拆开',
      });
    }
  });
  const finalEnd = analysis.shots.at(-1)!.endSecond;
  if (Math.abs(finalEnd - analysis.durationSeconds) > epsilon) {
    context.addIssue({ code: 'custom', path: ['shots'], message: '镜号时间轴必须连续覆盖到视频总时长' });
  }
});

export function talkingVideoAnalysisSchemaForDuration(durationSeconds?: number) {
  if (!durationSeconds) return talkingVideoAnalysisSchema;
  return talkingVideoAnalysisSchema.superRefine((analysis, context) => {
    if (Math.abs(analysis.durationSeconds - durationSeconds) > 0.05) {
      context.addIssue({
        code: 'custom',
        path: ['durationSeconds'],
        message: `视频总时长必须使用媒体元数据给出的 ${durationSeconds} 秒，禁止自行估算`,
      });
    }
  });
}

export type TalkingVideoAnalysis = z.infer<typeof talkingVideoAnalysisSchema>;

function extractPromptShotBlocks(generationBody: string) {
  const matches = [...generationBody.matchAll(/(?:^|\n)(镜号\s*\d+\s*｜[^\n]+)/gu)];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const nextStart = matches[index + 1]?.index ?? generationBody.length;
    return generationBody.slice(start, nextStart).trim();
  });
}

function extractExecutableShotLines(shotBlock: string) {
  return shotBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:画面|表演要点|拍摄注意)：/u.test(line));
}

function hasAffirmativeOverlayLine(line: string) {
  if (!/(?:画中画|PIP|头像框|圆形头像|叠加窗口)/iu.test(line)) return false;
  if (/(?:不(?:要|能|得)?|禁止|避免|移除|去掉|删除|取消|不保留|不要出现|不得出现).{0,10}(?:画中画|PIP|头像框|圆形头像|叠加窗口)/iu.test(line)) {
    return false;
  }
  return true;
}

function hasAffirmativeVisiblePresenterLine(line: string) {
  if (!/(?:讲解者|模特|主播|主持人|人物出镜|面对镜头|口播人物|全屏人物|出镜人物)/u.test(line)) return false;
  if (/(?:无人物出镜|人物不出镜|讲解者不出镜|模特不出镜|主播不出镜|主持人不出镜|不(?:要|能|得)?(?:让)?(?:讲解者|模特|主播|主持人|人物)出镜|不要出现(?:讲解者|模特|主播|主持人|人物)|仅保留主画面)/u.test(line)) {
    return false;
  }
  return true;
}

function hasFullScreenPresenterDropLine(line: string) {
  if (!/(?:无人物出镜|仅展示产品|纯产品展示|只有场景|旁白讲解)/u.test(line)) return false;
  if (/(?:不要|不能|不得|禁止|避免).{0,8}(?:无人物出镜|仅展示产品|纯产品展示|只有场景|旁白讲解)/u.test(line)) {
    return false;
  }
  return true;
}

export function validateTalkingVideoPrompt(prompt: string, analysis: TalkingVideoAnalysis) {
  const issues: string[] = [];
  if (/同镜号|同上一镜|同上|参数无变动|场景、人物状态无变化/u.test(prompt)) {
    issues.push('每个镜头必须写出完整独立描述，不能使用“同镜号/同上/参数无变动”等省略表达');
  }
  const generationBody = prompt.split(/(?:^|\n)分段A(?:\n|$)/u)[1] || prompt;
  if (/(?:叠加|显示|生成|切换为).{0,12}(?:字幕|标题|文字|大字)|(?:字幕|标题|关键词).{0,12}(?:标黄|显示|切换)/u.test(generationBody)) {
    issues.push('最终生成画面禁止字幕、标题、关键词标黄或其他可读文字');
  }
  if (/(?:^|\n)镜号[\s\S]*@图片\d+/u.test(generationBody)) {
    issues.push('素材引用只能集中写在分段前，镜头正文不能重复标记');
  }
  const firstShotIndex = prompt.search(/(?:^|\n)镜号\s*1\s*｜/u);
  analysis.imageReferences.forEach((reference) => {
    const token = `@图片${reference.imageIndex}`;
    const matches = prompt.match(new RegExp(token, 'gu')) || [];
    if (matches.length !== 1 || firstShotIndex < 0 || prompt.indexOf(token) > firstShotIndex) {
      issues.push(`${token} 必须在镜号正文前集中说明用途，并且全文只出现一次`);
    }
    const usageLine = prompt.split('\n').find((line) => line.includes(token)) || '';
    const forbiddenByRole: Record<TalkingVideoPromptImage['role'], RegExp> = {
      model: /(?:背景|场景|客厅|卧室|室内|户外|街道|空间|家具|陈设|产品|商品|包装|道具|光线|灯光|色调|构图)/u,
      product: /(?:背景|场景|客厅|卧室|室内|户外|街道|空间|家具|陈设|人物|模特|面孔|发型|光线|灯光|色调|构图)/u,
      background: /(?:人物|模特|面孔|发型|服装|产品|商品|包装|手持物)/u,
      detail: /(?:人物身份|模特身份|产品主体|商品主体|背景|场景|客厅|卧室|室内|户外|街道|空间)/u,
    };
    if (forbiddenByRole[reference.role].test(usageLine)) {
      issues.push(`${token} 是${talkingVideoRoleLabels[reference.role]}图，素材用途声明混入了其他角色的信息；必须只描述该素材角色本身，场景等其他维度另行独立说明`);
    }
  });
  const promptShots = [...generationBody.matchAll(/(?:^|\n)镜号\s*(\d+)\s*｜[^｜\n]+｜\s*([\d.]+)\s*-\s*([\d.]+)\s*秒/gu)];
  if (promptShots.length !== analysis.shots.length) {
    issues.push(`最终提示词必须保留拆解得到的 ${analysis.shots.length} 个镜号，当前只有 ${promptShots.length} 个`);
  } else {
    const timelineChanged = promptShots.some((match, index) => {
      const shot = analysis.shots[index]!;
      return Number(match[1]) !== index + 1
        || Math.abs(Number(match[2]) - shot.startSecond) > 0.05
        || Math.abs(Number(match[3]) - shot.endSecond) > 0.05;
    });
    if (timelineChanged) {
      issues.push('最终提示词的镜号编号和起止时间必须与结构化拆解完全一致');
    }
  }
  const requiredFieldCounts = {
    '画面': (generationBody.match(/(?:^|\n)画面：/gu) || []).length,
    '台词': (generationBody.match(/(?:^|\n)台词：/gu) || []).length,
    '表演要点': (generationBody.match(/(?:^|\n)表演要点：/gu) || []).length,
    '拍摄注意': (generationBody.match(/(?:^|\n)拍摄注意：/gu) || []).length,
  };
  Object.entries(requiredFieldCounts).forEach(([field, count]) => {
    if (count !== analysis.shots.length) {
      issues.push(`每个镜号都必须独立、完整地包含“${field}”，不能省略或合并`);
    }
  });
  analysis.shots.forEach((shot, index) => {
    if (shot.dialogue.trim() && !prompt.includes(shot.dialogue.trim())) {
      issues.push(`镜号${index + 1}必须逐字保留已识别口播：“${shot.dialogue.trim()}”`);
    }
  });
  const shotBlocks = extractPromptShotBlocks(generationBody);
  const executableShotLines = shotBlocks.map(extractExecutableShotLines);
  const allExecutableLines = executableShotLines.flat();
  const shotHasOverlay = executableShotLines.map((lines) => lines.some(hasAffirmativeOverlayLine));
  const hasAnyOverlay = shotHasOverlay.some(Boolean);
  const hasAnyVisiblePresenter = allExecutableLines.some(hasAffirmativeVisiblePresenterLine);

  if (analysis.presentationLayout.type === 'picture_in_picture') {
    if (/全程/u.test(analysis.presentationLayout.persistence)) {
      if (shotHasOverlay.length !== analysis.shots.length || shotHasOverlay.some((value) => !value)) {
        issues.push('参考视频为全程画中画布局，最终提示词的每个镜号都必须保留讲解者叠加层，不能在后续镜号丢失');
      }
    } else if (!hasAnyOverlay) {
      issues.push('参考视频使用画中画讲解者，最终提示词必须保留主画面与讲解者叠加层，不能改成全屏人物口播');
    }
  }
  if (analysis.presentationLayout.type === 'voice_over') {
    if (hasAnyOverlay) {
      issues.push('参考视频为旁白主导布局，最终提示词不能新增画中画讲解者或叠加头像框');
    }
    if (hasAnyVisiblePresenter) {
      issues.push('参考视频为 voice_over，最终提示词不能凭空增加出镜讲解人物或全屏主持人口播');
    }
  }
  if (analysis.presentationLayout.type === 'full_screen_presenter') {
    if (hasAnyOverlay) {
      issues.push('参考视频为全屏讲解者，最终提示词不能改成画中画或叠加讲解者布局');
    }
    if (allExecutableLines.some(hasFullScreenPresenterDropLine)) {
      issues.push('参考视频为 full_screen_presenter，最终提示词必须保持讲解者作为主画面主体，不能退化成纯旁白或纯产品镜头');
    }
    if (!hasAnyVisiblePresenter) {
      issues.push('参考视频为 full_screen_presenter，最终提示词必须明确保留出镜讲解者作为主画面主体');
    }
  }
  return issues;
}

export function normalizeTalkingVideoPrompt(value: string) {
  let normalized = value
    .trim()
    .replace(/^```(?:markdown|text)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
  if (!/^画面不要生成字幕/u.test(normalized)) {
    normalized = `画面不要生成字幕、字幕条、标题字、贴片文字、平台水印或其他可读文字。\n\n${normalized}`;
  }
  if (!/(?:^|\n)分段A(?:\n|$)/u.test(normalized)) {
    normalized = normalized.replace(/(^|\n)(镜号\s*1\s*｜)/u, '$1分段A\n\n$2');
  }
  return normalized;
}
