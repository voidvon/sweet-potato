import type { SkillFile } from '../../types';
import { request } from '../request';

enum Api {
  skills = '/api/skills',
  upload = '/api/skills/upload',
  skillDetail = '/api/skills/:skillId',
}

export function listSkills(userId: string) {
  void userId;
  return request<SkillFile[]>(Api.skills);
}

export function uploadSkill(payload: { content: string; fileName: string; userId: string }) {
  const { userId: _userId, ...requestPayload } = payload;
  return request<SkillFile>(Api.upload, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  });
}

export function updateSkillProfile(skillId: string, payload: { command: string; name: string }) {
  return request<SkillFile>(Api.skillDetail.replace(':skillId', skillId), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteSkill(skillId: string) {
  return request<void>(Api.skillDetail.replace(':skillId', skillId), {
    method: 'DELETE',
  });
}
