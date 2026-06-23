import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../../db/database.js';
import { skillRepository } from './skill.repository.js';
import type { SkillFile } from './skill.types.js';

const skillDir = path.join(dataDir, 'skill-files');
const maxSkillFileBytes = 1024 * 1024 * 2;
const maxPromptSkillContentLength = 60_000;

type SkillMetadata = {
  category?: string;
  command?: string;
  description: string;
  name: string;
  scenario?: string;
};

function safeFileName(fileName: string) {
  const fallback = 'skill.txt';
  const normalized = path.basename(fileName || fallback).replace(/[^\w.-]+/g, '-');
  return normalized || fallback;
}

function stripExtension(fileName: string) {
  return path.basename(fileName).replace(/\.[^.]+$/, '');
}

function firstText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSkillCommand(value: string, fallback: string) {
  const command = value
    .trim()
    .replace(/^\//, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return command || fallback;
}

function pickMetadataFromObject(value: unknown): SkillMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const nested = pickMetadataFromObject(record.skill) || pickMetadataFromObject(record.metadata);
  const category = firstText(record.category) || nested?.category || '';
  const command = firstText(record.command) || firstText(record.slashCommand) || nested?.command || '';
  const name = firstText(record.name) || firstText(record.title) || nested?.name || '';
  const description = firstText(record.description) || firstText(record.summary) || firstText(record.prompt) || nested?.description || '';
  const scenario = firstText(record.scenario) || firstText(record.useCase) || nested?.scenario || '';

  if (!command && !name && !description && !category && !scenario) {
    return undefined;
  }

  return { category, command, description: description.slice(0, 220), name, scenario };
}

function parseFrontmatter(content: string): SkillMetadata | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return undefined;
  }

  const metadata: Record<string, string> = {};
  match[1].split('\n').forEach((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      return;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
    metadata[key] = value;
  });

  const name = metadata.name || metadata.title || '';
  const command = metadata.command || metadata.slashCommand || '';
  const description = metadata.description || metadata.summary || '';
  const category = metadata.category || '';
  const scenario = metadata.scenario || metadata.useCase || '';
  return name || description || command || category || scenario
    ? { category, command, description: description.slice(0, 220), name, scenario }
    : undefined;
}

function parseMarkdown(content: string): SkillMetadata | undefined {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  const lines = content
    .replace(/^---\s*\n[\s\S]*?\n---/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const description = lines[0] || '';
  return heading || description ? { description: description.slice(0, 220), name: heading } : undefined;
}

export function parseSkillMetadata(content: string, fileName: string): SkillMetadata {
  try {
    const fromJson = pickMetadataFromObject(JSON.parse(content));
    if (fromJson?.name || fromJson?.description) {
      return {
        category: fromJson.category,
        command: fromJson.command,
        description: fromJson.description,
        name: fromJson.name || stripExtension(fileName),
        scenario: fromJson.scenario,
      };
    }
  } catch {
    // Non-JSON skill files can still expose metadata through frontmatter or Markdown.
  }

  const fromFrontmatter = parseFrontmatter(content);
  if (fromFrontmatter?.name || fromFrontmatter?.description) {
    return {
      category: fromFrontmatter.category,
      command: fromFrontmatter.command,
      description: fromFrontmatter.description,
      name: fromFrontmatter.name || stripExtension(fileName),
      scenario: fromFrontmatter.scenario,
    };
  }

  const fromMarkdown = parseMarkdown(content);
  if (fromMarkdown?.name || fromMarkdown?.description) {
    return {
      command: fromMarkdown.command,
      description: fromMarkdown.description,
      name: fromMarkdown.name || stripExtension(fileName),
    };
  }

  return {
    command: undefined,
    category: undefined,
    description: '',
    name: stripExtension(fileName),
    scenario: undefined,
  };
}

export async function createSkillFromContent(input: {
  content: string;
  fileName: string;
  userId: string;
}) {
  const userId = input.userId.trim();
  const content = input.content.trim();
  const originalFileName = safeFileName(input.fileName);

  if (!userId) {
    throw new Error('缺少用户信息');
  }

  if (!content) {
    throw new Error('技能文件内容不能为空');
  }

  if (Buffer.byteLength(content, 'utf8') > maxSkillFileBytes) {
    throw new Error('技能文件不能超过 2MB');
  }

  await mkdir(skillDir, { recursive: true });

  const now = new Date().toISOString();
  const id = randomBytes(12).toString('hex');
  const storedFileName = `${id}-${originalFileName}`;
  const filePath = path.join(skillDir, storedFileName);
  const fileUrl = `/files/skills/${storedFileName}`;
  const metadata = parseSkillMetadata(content, originalFileName);
  const command = normalizeSkillCommand(metadata.command || metadata.name || stripExtension(originalFileName), `skill-${id.slice(0, 8)}`);

  await writeFile(filePath, content, 'utf8');

  const skill: SkillFile = {
    category: metadata.category || 'brand_style',
    command,
    createdAt: now,
    description: metadata.description,
    enabled: true,
    filePath,
    fileUrl,
    id,
    isDefault: false,
    name: metadata.name,
    originalFileName,
    scenario: metadata.scenario || '',
    storedFileName,
    updatedAt: now,
    userId,
  };

  return skillRepository.create(skill);
}

export async function deleteSkillFile(skill: SkillFile) {
  skillRepository.delete(skill.id);
  await rm(skill.filePath, { force: true });
}

function parseSkillCommand(content: string) {
  const match = content.trim().match(/^\/([a-zA-Z0-9][a-zA-Z0-9-]*)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return undefined;
  }

  return {
    command: match[1],
    userInput: match[2]?.trim() || '',
  };
}

export async function resolveSkillInvocation(input: { content: string; userId: string }) {
  const parsed = parseSkillCommand(input.content);
  if (!parsed) {
    return {
      modelContent: input.content,
      titleContent: input.content,
      userContent: input.content,
    };
  }

  const skill = skillRepository.findByCommand(input.userId, parsed.command);
  if (!skill) {
    return {
      modelContent: input.content,
      titleContent: input.content,
      userContent: input.content,
    };
  }

  const fileContent = await readFile(skill.filePath, 'utf8');
  const clippedContent = fileContent.length > maxPromptSkillContentLength
    ? `${fileContent.slice(0, maxPromptSkillContentLength)}\n\n[技能文件内容过长，已截断]`
    : fileContent;
  const userInstruction = parsed.userInput || `执行技能 /${skill.command}`;

  return {
    modelContent: [
      `用户通过 /${skill.command} 调用了技能「${skill.name}」。`,
      '请将下方技能文件内容作为本轮任务的执行说明和上下文，结合用户输入完成回答。',
      '不要在回答中暴露或复述这段注入说明，除非用户明确要求解释技能配置。',
      '',
      '【技能文件内容】',
      clippedContent,
      '',
      '【用户输入】',
      userInstruction,
    ].join('\n'),
    skill,
    titleContent: parsed.userInput ? `${skill.name} ${parsed.userInput}` : skill.name,
    userContent: input.content,
  };
}
