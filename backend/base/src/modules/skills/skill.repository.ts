import { db } from '../../db/database.js';
import type { SkillFile } from './skill.types.js';

type SkillRow = {
  category: string;
  createdAt: string;
  command: string;
  description: string;
  enabled: number;
  filePath: string;
  fileUrl: string;
  id: string;
  isDefault: number;
  name: string;
  originalFileName: string;
  scenario: string;
  storedFileName: string;
  updatedAt: string;
  userId: string;
};

const selectSkill = `
  SELECT
    id,
    user_id as userId,
    command,
    name,
    description,
    category,
    scenario,
    enabled,
    is_default as isDefault,
    original_file_name as originalFileName,
    stored_file_name as storedFileName,
    file_path as filePath,
    file_url as fileUrl,
    created_at as createdAt,
    updated_at as updatedAt
  FROM skill_files
`;

function serializeSkill(row: SkillRow): SkillFile {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.isDefault),
  };
}

export const skillRepository = {
  create(skill: SkillFile) {
    db.prepare(`
      INSERT INTO skill_files (
        id, user_id, command, name, description, category, scenario, enabled, is_default,
        original_file_name, stored_file_name, file_path, file_url, created_at, updated_at
      )
      VALUES (
        @id, @userId, @command, @name, @description, @category, @scenario, @enabled, @isDefault,
        @originalFileName, @storedFileName, @filePath, @fileUrl, @createdAt, @updatedAt
      )
    `).run({
      ...skill,
      enabled: skill.enabled ? 1 : 0,
      isDefault: skill.isDefault ? 1 : 0,
    });
    const created = this.find(skill.id);
    if (!created) {
      throw new Error('技能文件创建失败');
    }
    return created;
  },

  delete(id: string) {
    db.prepare('DELETE FROM skill_files WHERE id = ?').run(id);
  },

  find(id: string) {
    const row = db.prepare(`${selectSkill} WHERE id = ?`).get(id) as SkillRow | undefined;
    return row ? serializeSkill(row) : undefined;
  },

  findByCommand(userId: string, command: string) {
    const row = db.prepare(`${selectSkill} WHERE user_id = ? AND command = ?`).get(userId, command) as SkillRow | undefined;
    return row ? serializeSkill(row) : undefined;
  },

  list(userId: string) {
    const rows = db.prepare(`${selectSkill} WHERE user_id = ? ORDER BY updated_at DESC`).all(userId) as SkillRow[];
    return rows.map(serializeSkill);
  },

  updateProfile(input: {
    category: string;
    command: string;
    enabled: boolean;
    id: string;
    isDefault: boolean;
    name: string;
    scenario: string;
    updatedAt: string;
  }) {
    db.prepare(`
      UPDATE skill_files
      SET name = @name,
          command = @command,
          category = @category,
          scenario = @scenario,
          enabled = @enabled,
          is_default = @isDefault,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      ...input,
      enabled: input.enabled ? 1 : 0,
      isDefault: input.isDefault ? 1 : 0,
    });

    return this.find(input.id);
  },
};
