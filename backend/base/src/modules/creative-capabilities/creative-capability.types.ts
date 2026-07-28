import type { z } from 'zod';

export type CreativeMediaKind = 'image' | 'video';

export type CreativeCapabilityField = {
  key: string;
  label: string;
  valueType: 'string' | 'number' | 'boolean' | 'asset' | 'asset-list';
  required?: boolean;
  overridable?: boolean;
};

export type CreativeCapabilityDefinition = {
  key: string;
  label: string;
  mediaKind: CreativeMediaKind;
  schemaVersion: number;
  globalFields: CreativeCapabilityField[];
  rowFields: CreativeCapabilityField[];
  globalParamsSchema: z.ZodType<Record<string, unknown>>;
  rowParamsSchema: z.ZodType<Record<string, unknown>>;
};

export type CreativeCapabilitySummary = Omit<
  CreativeCapabilityDefinition,
  'globalParamsSchema' | 'rowParamsSchema'
>;

export type CreativeCapabilityExecutionContext = {
  userId: string;
  sourceType: string;
  sourceId: string;
  generationJobId?: string | null;
  onExternalJobCreated?: (generationJobId: string) => void | Promise<void>;
  signal?: AbortSignal;
};

export type CreativeCapabilityExecutionResult = {
  outputAssetIds: string[];
  creditCost: number;
  metadata?: Record<string, unknown>;
};

export type CreativeCapabilityPreparedExecution = {
  effectiveParams: Record<string, unknown>;
  modelConfigSnapshot: Record<string, unknown>;
  estimatedCredits: number;
};

export type CreativeCapabilityExecutor = {
  prepare(
    context: CreativeCapabilityExecutionContext,
    params: Record<string, unknown>,
  ): CreativeCapabilityPreparedExecution | Promise<CreativeCapabilityPreparedExecution>;
  execute(
    context: CreativeCapabilityExecutionContext,
    prepared: CreativeCapabilityPreparedExecution,
  ): Promise<CreativeCapabilityExecutionResult>;
};
