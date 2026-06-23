import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteSkill, listSkills, updateSkillProfile, uploadSkill } from '../../../api/skills';
import { getStoredUser } from '../../../utils/session';
import type { ClawSkill } from '../types';

const builtInSkills: ClawSkill[] = [
  // { command: 'workflow', description: '启动自动化工作流', name: '启动工作流' },
  // { command: 'wechat-bot', description: '启动微信机器人', name: '启动微信机器人' },
  // { command: 'enterprise-wechat-bot', description: '启动企微机器人', name: '启动企微机器人' },
  // { command: 'douyin-support', description: '启动抖音客服', name: '启动抖音客服' },
  // { command: 'short-video-exposure', description: '启动短视频曝光', name: '启动短视频曝光' },
  { command: 'short-video', description: '生成短视频', name: '生成短视频' },
  // { command: 'publish-video', description: '自动发布视频', name: '自动发布视频' },
  // { command: 'geo-task', description: '创建 GEO 优化任务', name: '创建geo任务' },
  // { command: 'geo-task-publish', description: '发布 GEO 任务', name: '发布geo任务' },
].map((skill, index) => ({
  createdAt: new Date(0).toISOString(),
  id: `built-in-${index}`,
  ...skill,
  source: 'built-in',
}));

function createSkillId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `skill-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useSkillCenter() {
  const [open, setOpen] = useState(false);
  const [uploadedSkills, setUploadedSkills] = useState<ClawSkill[]>([]);
  const currentUserId = getStoredUser()?.id || 'default';

  const skills = useMemo(() => [...builtInSkills, ...uploadedSkills], [uploadedSkills]);

  const loadUploadedSkills = useCallback(async () => {
    const remoteSkills = await listSkills(currentUserId);
    setUploadedSkills(remoteSkills.map((skill) => ({
      command: skill.command,
      createdAt: skill.createdAt,
      description: skill.description,
      fileUrl: skill.fileUrl,
      id: skill.id,
      name: skill.name,
      source: 'uploaded',
    })));
  }, [currentUserId]);

  useEffect(() => {
    void loadUploadedSkills();
  }, [loadUploadedSkills]);

  const removeSkill = useCallback(async (skillId: string) => {
    await deleteSkill(skillId);
    setUploadedSkills((current) => current.filter((skill) => skill.id !== skillId));
  }, []);

  const updateSkill = useCallback(async (skillId: string, payload: { command: string; name: string }) => {
    const skill = await updateSkillProfile(skillId, payload);
    setUploadedSkills((current) => current.map((item) => (
      item.id === skill.id
        ? {
          command: skill.command,
          createdAt: skill.createdAt,
          description: skill.description,
          fileUrl: skill.fileUrl,
          id: skill.id,
          name: skill.name,
          source: 'uploaded',
        }
        : item
    )));
  }, []);

  const uploadSkillFile = useCallback(async (file: File) => {
    const text = await file.text();
    const skill = await uploadSkill({
      content: text,
      fileName: file.name || `${createSkillId()}.txt`,
      userId: currentUserId,
    });
    setUploadedSkills((current) => [{
      command: skill.command,
      createdAt: skill.createdAt,
      description: skill.description,
      fileUrl: skill.fileUrl,
      id: skill.id,
      name: skill.name,
      source: 'uploaded',
    }, ...current]);
  }, [currentUserId]);

  return {
    open,
    removeSkill,
    setOpen,
    skills,
    updateSkill,
    uploadSkillFile,
  };
}
