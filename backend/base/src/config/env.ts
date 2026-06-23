import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnvFile() {
  const candidates = [
    process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : '',
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/base/.env'),
    '/app/.env',
  ];
  const envPath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!envPath) {
    console.warn('No local env file found');
    return;
  }
  console.info('Loaded local env file', { path: envPath });
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

export const env = {
  port: Number(process.env.PORT || 7072),
};

export const desktopAutomationBridge = {
  baseUrl: String(process.env.DESKTOP_AUTOMATION_BASE_URL || 'http://127.0.0.1:7074').trim().replace(/\/+$/, ''),
  taskTimeoutMs: Number(process.env.DESKTOP_AUTOMATION_TASK_TIMEOUT_MS || 180000),
  pollIntervalMs: Number(process.env.DESKTOP_AUTOMATION_POLL_INTERVAL_MS || 1000),
};

export const authTokenSecret = String(
  process.env.JWT_SECRET
  || process.env.AUTH_TOKEN_SECRET
  || 'ai-marketing-desktop-server-dev-secret',
).trim() || 'ai-marketing-desktop-server-dev-secret';

export const authTokenExpiresInSeconds = Number(
  process.env.JWT_EXPIRES_IN_SECONDS
  || 60 * 60 * 24 * 30,
);

export const contentPublicBaseUrl = String(
  process.env.CONTENT_PUBLIC_BASE_URL
  || process.env.PUBLIC_BASE_URL
  || process.env.APP_BASE_URL
  || '',
).trim().replace(/\/+$/, '');

function parseSizeMb(value: string | undefined, fallbackMb: number) {
  const parsed = Number(value || fallbackMb);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 * 1024 : fallbackMb * 1024 * 1024;
}

export const contentUploadLimitBytes = parseSizeMb(process.env.CONTENT_UPLOAD_LIMIT_MB, 20);
export const vodUploadLimitBytes = parseSizeMb(process.env.VOD_UPLOAD_LIMIT_MB, 500);

export const volcengineRealPersonConfig = {
  accessKey: String(process.env.VOLC_ACCESSKEY || '').trim(),
  secretKey: String(process.env.VOLC_SECRETKEY || '').trim(),
  projectName: String(process.env.VOLC_VIRTUAL_PORTTRAIT_PROJECT_NAME || 'default').trim() || 'default',
  callbackBaseUrl: String(process.env.VOLC_REAL_PERSON_CALLBACK_BASE_URL || '').trim().replace(/\/+$/, ''),
  contentPublicBaseUrl: String(process.env.CONTENT_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
};

export const volcengineVirtualPortraitConfig = {
  accessKey: String(process.env.VOLC_ACCESSKEY || '').trim(),
  secretKey: String(process.env.VOLC_SECRETKEY || '').trim(),
  projectName: String(process.env.VOLC_VIRTUAL_PORTTRAIT_PROJECT_NAME || 'default').trim() || 'default',
  uploadTimeoutMs: Number(process.env.VOLC_VIRTUAL_PORTTRAIT_UPLOAD_TIMEOUT_MS || 120000),
};

// const defaultDigitalHumanThreeViewPrompt = `人物角色设计稿，
// 一张图内包含全身三视图+面部细节三视图，
// 上半部分为人物全身正面、左侧面、右侧面、背面三视图共三张图，
// 下半部分为人物面部正面、左侧面、右侧面细节三视图共三张图，
// 整齐对称排版，人体结构精准，比例标准，无透视错误，干净白色背景，
// 高清细节，美术设定集风格，线条流畅，完整无裁切，要电影级写实风格，
// 保留原有人物的全部细节特征。`;

const defaultDigitalHumanThreeViewPrompt = `photorealistic professional character design sheet, 
strict two-row fixed grid layout, upper row: 
three complete full-body orthographic views, 
strict front view, strict side view, strict back view, 
full body head to toe, complete feet without cropping, 
no missing limbs, lower row: three independent pure head frames only, 
frame 1: absolute 0 degree orthographic front head, zero yaw zero tilt zero rotation, 
frame 2: fixed +45 degree yaw left three-quarter head view, 
frame 3: fixed -45 degree yaw right three-quarter head view, 
left and right ±45 degrees perfectly mirror symmetrical, 
same perspective angle, cropped strictly at jawline, pure head only, 
absolutely no neck, no shoulders, no torso, no any body parts, 
rigid grid partition, each frame independent, no cross-border elements, 
unified soft studio lighting, plain neutral gray background, ultra realistic, 
high detail, 8K, sharp focus, bust shot, neck appearing, shoulder appearing, 
torso appearing, tilted face, random slight angle, asymmetric side angle, 
inconsistent left right head angle, view order disorder, messy layout, 
deformed anatomy, multiple people, text, watermark, logo, 
complex background, truncated body, cut off feet`;
export const digitalHumanThreeViewPrompt = process.env.DIGITAL_HUMAN_THREE_VIEW_PROMPT?.trim()
  || defaultDigitalHumanThreeViewPrompt;
