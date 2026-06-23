import { createRequire } from 'node:module';
import { volcengineVirtualPortraitConfig } from '../../config/env.js';

const require = createRequire(import.meta.url);
const { Service } = require('@volcengine/openapi') as typeof import('@volcengine/openapi');

const volcServiceName = 'ark';
const volcVersion = '2024-01-01';
const volcRegion = 'cn-beijing';
const volcHost = 'ark.cn-beijing.volcengineapi.com';
const defaultProjectName = 'default';

type ArkOpenApiResponse<T> = {
  ResponseMetadata?: {
    RequestId?: string;
    Action?: string;
    Version?: string;
    Service?: string;
    Region?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
  Result?: T;
} & Record<string, unknown>;

export type VolcenginePrivateAssetType = 'Image' | 'Video' | 'Audio';
export type VolcenginePrivateAssetStatus = 'Active' | 'Processing' | 'Failed' | string;

type NormalizedResponse<T> = {
  raw: ArkOpenApiResponse<T>;
  result: T;
};

type CreateAssetGroupResult = {
  Id?: string;
  GroupId?: string;
};

type PrivateAssetGroupResult = {
  Id?: string;
  Name?: string;
  Description?: string;
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
};

type ListAssetGroupsResult = {
  AssetGroups?: PrivateAssetGroupResult[];
  Items?: PrivateAssetGroupResult[];
  Total?: number;
  TotalCount?: number;
  PageNumber?: number;
  PageSize?: number;
};

type CreateAssetResult = {
  Id?: string;
};

export type VolcenginePrivateAssetResult = {
  Id?: string;
  Name?: string;
  URL?: string;
  AssetType?: VolcenginePrivateAssetType | string;
  GroupId?: string;
  Status?: VolcenginePrivateAssetStatus;
  Error?: {
    Code?: string;
    Message?: string;
  };
  CreateTime?: string;
  UpdateTime?: string;
  ProjectName?: string;
};

type ListAssetsResult = {
  Assets?: VolcenginePrivateAssetResult[];
  Items?: VolcenginePrivateAssetResult[];
  Total?: number;
  TotalCount?: number;
  PageNumber?: number;
  PageSize?: number;
};

type DeleteResult = Record<string, unknown>;

export type CreatePrivateAssetGroupResponse = NormalizedResponse<CreateAssetGroupResult> & {
  groupId: string;
  projectName: string;
};

export type CreatePrivateAssetResponse = NormalizedResponse<CreateAssetResult> & {
  assetId: string;
  assetUri: string;
  projectName: string;
};

export type GetPrivateAssetResponse = NormalizedResponse<VolcenginePrivateAssetResult> & {
  asset: VolcenginePrivateAssetResult;
  assetId: string;
  status: VolcenginePrivateAssetStatus;
  url: string;
  failureReason: string;
  projectName: string;
};

export type ListPrivateAssetsResponse = NormalizedResponse<ListAssetsResult> & {
  assets: VolcenginePrivateAssetResult[];
  projectName: string;
};

function assertVolcCredentials() {
  if (!volcengineVirtualPortraitConfig.accessKey || !volcengineVirtualPortraitConfig.secretKey) {
    throw new Error('缺少火山私域素材配置：请配置 VOLC_ACCESSKEY 和 VOLC_SECRETKEY');
  }
}

function projectNameOf(projectName?: string) {
  return projectName?.trim() || volcengineVirtualPortraitConfig.projectName || defaultProjectName;
}

function createArkService() {
  assertVolcCredentials();
  return new Service({
    accessKeyId: volcengineVirtualPortraitConfig.accessKey,
    secretKey: volcengineVirtualPortraitConfig.secretKey,
    defaultVersion: volcVersion,
    host: volcHost,
    region: volcRegion,
    serviceName: volcServiceName,
  });
}

function arkRequestConfig() {
  const timeout = Number(volcengineVirtualPortraitConfig.uploadTimeoutMs);
  return Number.isFinite(timeout) && timeout > 0 ? { timeout } : undefined;
}

function resultOf<T>(response: ArkOpenApiResponse<T>) {
  if (response.ResponseMetadata?.Error) {
    const error = response.ResponseMetadata.Error;
    if (/not authorized|AccessDenied/i.test(error.Message || '')) {
      throw new Error(`当前火山 AK/SK 没有私域人物素材 API 权限：请在火山 IAM 为该用户授权 ark:CreateAsset 等 Asset 接口；如果日志中 projectName 已显示为目标项目，说明项目名已传入，仍失败则是该 AK/SK 缺少 CreateAsset 权限。原始错误：${error.Message}`);
    }
    if (/active subscription|advanced|premium/i.test(error.Message || '')) {
      throw new Error('火山私域人物素材 API 需要开通对应权益包，请确认账号权限。');
    }
    throw new Error(error.Message || `火山私域素材接口调用失败：${error.Code || '未知错误'}`);
  }
  return (response.Result ?? response) as T;
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isFlowControlLimitError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /(flow control limit|request speed.*beyond|too many requests|rate limit)/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callArkJson<T>(action: string, body: Record<string, unknown>) {
  const service = createArkService();
  const api = service.createJSONAPI(action, {
    Version: volcVersion,
    method: 'POST',
    contentType: 'json',
  });
  const requestConfig = arkRequestConfig() as Parameters<typeof api>[1];
  let lastError: unknown;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await api(body, requestConfig) as ArkOpenApiResponse<T>;
      const result = resultOf<T>(raw);
      return { raw, result };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isFlowControlLimitError(error)) {
        throw error;
      }
      await sleep(300 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function failureReasonOf(asset: VolcenginePrivateAssetResult) {
  return [asset.Error?.Code, asset.Error?.Message].filter(Boolean).join('：');
}

export const volcenginePrivateAssetClient = {
  async createAssetGroup(input: {
    name: string;
    description?: string;
    projectName?: string;
  }): Promise<CreatePrivateAssetGroupResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<CreateAssetGroupResult>('CreateAssetGroup', {
      Name: input.name.slice(0, 64),
      Description: input.description?.slice(0, 256),
      ProjectName: projectName,
    });
    const groupId = stringField(response.result.Id) || stringField(response.result.GroupId);
    if (!groupId) {
      throw new Error('火山私域素材资产组创建响应缺少 Group ID');
    }
    return { ...response, groupId, projectName };
  },

  async listAssetGroups(input: {
    name?: string;
    groupIds?: string[];
    pageNumber?: number;
    pageSize?: number;
    projectName?: string;
  } = {}) {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<ListAssetGroupsResult>('ListAssetGroups', {
      Filter: {
        Name: input.name,
        GroupIds: input.groupIds,
        GroupType: 'AIGC',
      },
      PageNumber: input.pageNumber || 1,
      PageSize: input.pageSize || 10,
      ProjectName: projectName,
    });
    const groups = Array.isArray(response.result.AssetGroups)
      ? response.result.AssetGroups
      : Array.isArray(response.result.Items)
        ? response.result.Items
        : [];
    return { ...response, groups, projectName };
  },

  async getAssetGroup(input: {
    groupId: string;
    projectName?: string;
  }) {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<PrivateAssetGroupResult>('GetAssetGroup', {
      Id: input.groupId,
      ProjectName: projectName,
    });
    return { ...response, group: response.result, projectName };
  },

  async updateAssetGroup(input: {
    groupId: string;
    name: string;
    description?: string;
    projectName?: string;
  }) {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<PrivateAssetGroupResult>('UpdateAssetGroup', {
      Id: input.groupId,
      Name: input.name.slice(0, 64),
      Description: input.description?.slice(0, 256),
      ProjectName: projectName,
    });
    return { ...response, group: response.result, projectName };
  },

  async deleteAssetGroup(input: {
    groupId: string;
    projectName?: string;
  }) {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<DeleteResult>('DeleteAssetGroup', {
      Id: input.groupId,
      ProjectName: projectName,
    });
    return { ...response, projectName };
  },

  async createAsset(input: {
    groupId: string;
    url: string;
    name: string;
    assetType: VolcenginePrivateAssetType;
    projectName?: string;
  }): Promise<CreatePrivateAssetResponse> {
    const projectName = projectNameOf(input.projectName);
    if (!input.url) {
      throw new Error('火山私域素材创建缺少 URL');
    }
    const payload = {
      GroupId: input.groupId,
      Name: input.name.slice(0, 64),
      AssetType: input.assetType,
      URL: input.url,
      ProjectName: projectName,
    };
    const response = await callArkJson<CreateAssetResult>('CreateAsset', payload);
    const assetId = stringField(response.result.Id);
    if (!assetId) {
      throw new Error('火山私域素材创建响应缺少 Asset ID');
    }
    return {
      ...response,
      assetId,
      assetUri: `asset://${assetId}`,
      projectName,
    };
  },

  async getAsset(input: {
    assetId: string;
    projectName?: string;
  }): Promise<GetPrivateAssetResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<VolcenginePrivateAssetResult>('GetAsset', {
      Id: input.assetId,
      ProjectName: projectName,
    });
    const assetId = stringField(response.result.Id) || input.assetId;
    const status = stringField(response.result.Status) || 'Active';
    return {
      ...response,
      asset: response.result,
      assetId,
      status,
      url: stringField(response.result.URL),
      failureReason: failureReasonOf(response.result),
      projectName,
    };
  },

  async listAssets(input: {
    groupId?: string;
    name?: string;
    assetType?: VolcenginePrivateAssetType;
    statuses?: string[];
    pageNumber?: number;
    pageSize?: number;
    projectName?: string;
  } = {}): Promise<ListPrivateAssetsResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<ListAssetsResult>('ListAssets', {
      Filter: {
        GroupIds: input.groupId ? [input.groupId] : undefined,
        GroupType: 'AIGC',
        Statuses: input.statuses,
        Name: input.name,
        AssetType: input.assetType,
      },
      PageNumber: input.pageNumber || 1,
      PageSize: input.pageSize || 10,
      ProjectName: projectName,
    });
    const assets = Array.isArray(response.result.Assets)
      ? response.result.Assets
      : Array.isArray(response.result.Items)
        ? response.result.Items
        : [];
    return { ...response, assets, projectName };
  },

  async updateAsset(input: {
    assetId: string;
    name?: string;
    url?: string;
    projectName?: string;
  }) {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<VolcenginePrivateAssetResult>('UpdateAsset', {
      Id: input.assetId,
      Name: input.name?.slice(0, 64),
      URL: input.url || undefined,
      ProjectName: projectName,
    });
    return { ...response, asset: response.result, projectName };
  },

  async deleteAsset(input: {
    assetId: string;
    projectName?: string;
  }) {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<DeleteResult>('DeleteAsset', {
      Id: input.assetId,
      ProjectName: projectName,
    });
    return { ...response, projectName };
  },
};

export function isVolcenginePrivateAssetMissingError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /(not\s*found|不存在|does\s*not\s*exist|notexist|not\s*exist|404)/i.test(error.message);
}
