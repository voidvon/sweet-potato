export type ClawSkill = {
  command: string;
  createdAt: string;
  description?: string;
  fileUrl?: string;
  id: string;
  name: string;
  source: 'built-in' | 'uploaded';
};
