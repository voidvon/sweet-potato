export type AgentCapability = 'chat' | 'reasoning' | 'analysis' | 'imageUpload' | 'fileUpload' | 'mention';
export type AgentIcon = 'chat' | 'cube' | 'chart' | 'custom';
export type AgentRunMode = 'quick' | 'reasoning';
export type AgentRetrievalStrategy = 'semantic' | 'hybrid' | 'keyword';

export type AiAgent = {
  id: string;
  name: string;
  description: string;
  icon: AgentIcon;
  builtIn: boolean;
  capabilities: AgentCapability[];
  runMode: AgentRunMode;
  modelConfigId?: string | null;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  retrievalStrategy: AgentRetrievalStrategy;
  webSearchEnabled: boolean;
  multimodal: {
    imageUpload: boolean;
    fileUpload: boolean;
  };
  createdAt: string;
};

export type AgentRecord = Omit<AiAgent, 'builtIn' | 'capabilities' | 'tools' | 'skills' | 'webSearchEnabled' | 'multimodal'> & {
  builtIn: number;
  capabilities: string;
  tools: string;
  skills: string;
  webSearchEnabled: number;
  multimodal: string;
};
