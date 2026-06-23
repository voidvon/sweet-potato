import { db } from '../../db/database.js';
import type { AgentRecord, AiAgent } from './agent.types.js';

function serializeAgent(agent: AiAgent) {
  return {
    ...agent,
    builtIn: agent.builtIn ? 1 : 0,
    capabilities: JSON.stringify(agent.capabilities),
    modelConfigId: agent.modelConfigId || null,
    tools: JSON.stringify(agent.tools),
    skills: JSON.stringify(agent.skills),
    webSearchEnabled: agent.webSearchEnabled ? 1 : 0,
    multimodal: JSON.stringify(agent.multimodal),
  };
}

function parseAgent(record: AgentRecord): AiAgent {
  return {
    ...record,
    builtIn: Boolean(record.builtIn),
    capabilities: JSON.parse(record.capabilities),
    tools: JSON.parse(record.tools || '[]'),
    skills: JSON.parse(record.skills || '[]'),
    webSearchEnabled: Boolean(record.webSearchEnabled),
    multimodal: JSON.parse(record.multimodal || '{"imageUpload":false,"fileUpload":true}'),
  };
}

export const agentRepository = {
  list() {
    const selectAgentsQuery = db.prepare(`
      SELECT
        id,
        name,
        description,
        icon,
        built_in as builtIn,
        capabilities,
        run_mode as runMode,
        model_config_id as modelConfigId,
        system_prompt as systemPrompt,
        tools,
        skills,
        retrieval_strategy as retrievalStrategy,
        web_search_enabled as webSearchEnabled,
        multimodal,
        created_at as createdAt
      FROM agents
      ORDER BY built_in DESC, created_at ASC
    `);

    return (selectAgentsQuery.all() as AgentRecord[]).map(parseAgent);
  },

  find(id: string) {
    const findAgentQuery = db.prepare(`
      SELECT
        id,
        name,
        description,
        icon,
        built_in as builtIn,
        capabilities,
        run_mode as runMode,
        model_config_id as modelConfigId,
        system_prompt as systemPrompt,
        tools,
        skills,
        retrieval_strategy as retrievalStrategy,
        web_search_enabled as webSearchEnabled,
        multimodal,
        created_at as createdAt
      FROM agents
      WHERE id = ?
    `);

    const record = findAgentQuery.get(id) as AgentRecord | undefined;
    return record ? parseAgent(record) : undefined;
  },

  create(agent: AiAgent) {
    const insertAgentQuery = db.prepare(`
      INSERT INTO agents (
        id, name, description, icon, built_in, capabilities, run_mode, model_config_id,
        system_prompt, tools, skills, retrieval_strategy, web_search_enabled, multimodal, created_at
      )
      VALUES (
        @id, @name, @description, @icon, @builtIn, @capabilities, @runMode, @modelConfigId,
        @systemPrompt, @tools, @skills, @retrievalStrategy, @webSearchEnabled, @multimodal, @createdAt
      )
    `);

    insertAgentQuery.run(serializeAgent(agent));
    return agent;
  },

  update(agent: AiAgent) {
    const updateAgentQuery = db.prepare(`
      UPDATE agents
      SET
        name = @name,
        description = @description,
        icon = @icon,
        capabilities = @capabilities,
        run_mode = @runMode,
        model_config_id = @modelConfigId,
        system_prompt = @systemPrompt,
        tools = @tools,
        skills = @skills,
        retrieval_strategy = @retrievalStrategy,
        web_search_enabled = @webSearchEnabled,
        multimodal = @multimodal
      WHERE id = @id
    `);

    updateAgentQuery.run(serializeAgent(agent));
    return agent;
  },
};
