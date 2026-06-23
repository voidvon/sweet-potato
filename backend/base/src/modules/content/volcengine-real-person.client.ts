import { createRequire } from 'node:module';
import { volcengineRealPersonConfig } from '../../config/env.js';

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

type RealPersonAssetType = 'Image' | 'Video' | 'Audio';
type RealPersonAssetStatus = 'Active' | 'Processing' | 'Failed' | string;

type CreateVisualValidateSessionResult = {
  BytedToken?: string;
  H5Link?: string;
  CallbackURL?: string;
};

type GetVisualValidateResultResult = {
  GroupId?: string;
};

type CreateAssetResult = {
  Id?: string;
};

export type VolcengineRealPersonAssetResult = {
  Id?: string;
  Name?: string;
  URL?: string;
  AssetType?: RealPersonAssetType | string;
  GroupId?: string;
  Status?: RealPersonAssetStatus;
  Error?: {
    Code?: string;
    Message?: string;
  };
  CreateTime?: string;
  UpdateTime?: string;
  ProjectName?: string;
};

type ListAssetsResult = {
  Assets?: VolcengineRealPersonAssetResult[];
  Items?: VolcengineRealPersonAssetResult[];
  Total?: number;
  NextPageToken?: string;
};

type DeleteAssetResult = Record<string, unknown>;

type NormalizedResponse<T> = {
  raw: ArkOpenApiResponse<T>;
  result: T;
};

export type CreateVisualValidateSessionResponse = NormalizedResponse<CreateVisualValidateSessionResult> & {
  bytedToken: string;
  h5Link: string;
  callbackUrl: string;
  projectName: string;
};

export type GetVisualValidateResultResponse = NormalizedResponse<GetVisualValidateResultResult> & {
  groupId: string;
  projectName: string;
};

export type CreateRealPersonAssetResponse = NormalizedResponse<CreateAssetResult> & {
  assetId: string;
  assetUri: string;
  projectName: string;
};

export type GetRealPersonAssetResponse = NormalizedResponse<VolcengineRealPersonAssetResult> & {
  asset: VolcengineRealPersonAssetResult;
  assetId: string;
  status: RealPersonAssetStatus;
  url: string;
  failureReason: string;
  projectName: string;
};

export type ListRealPersonAssetsResponse = NormalizedResponse<ListAssetsResult> & {
  assets: VolcengineRealPersonAssetResult[];
  projectName: string;
};

export type DeleteRealPersonAssetResponse = NormalizedResponse<DeleteAssetResult> & {
  projectName: string;
};

function assertVolcCredentials() {
  if (!volcengineRealPersonConfig.accessKey || !volcengineRealPersonConfig.secretKey) {
    throw new Error('缺少火山真人素材配置：请配置 VOLC_ACCESSKEY 和 VOLC_SECRETKEY');
  }
}

function projectNameOf(projectName?: string) {
  return projectName?.trim() || volcengineRealPersonConfig.projectName || defaultProjectName;
}

function createArkService() {
  assertVolcCredentials();
  return new Service({
    accessKeyId: volcengineRealPersonConfig.accessKey,
    secretKey: volcengineRealPersonConfig.secretKey,
    defaultVersion: volcVersion,
    host: volcHost,
    region: volcRegion,
    serviceName: volcServiceName,
  });
}

function resultOf<T>(response: ArkOpenApiResponse<T>) {
  if (response.ResponseMetadata?.Error) {
    const error = response.ResponseMetadata.Error;
    if (/not authorized|AccessDenied/i.test(error.Message || '')) {
      throw new Error(`当前火山 AK/SK 没有真人素材 API 权限：请在火山 IAM 为该用户授权 ark:CreateVisualValidateSession，并确认 VOLCENGINE_PROJECT_NAME 对应已授权项目。原始错误：${error.Message}`);
    }
    if (/active subscription|advanced|premium/i.test(error.Message || '')) {
      throw new Error('火山真人素材 API 需要开通高级创作权益包或 Premium 权益；基础用户通常只能在控制台使用真人素材，不能调用 Assets API。');
    }
    throw new Error(error.Message || `火山真人素材接口调用失败：${error.Code || '未知错误'}`);
  }
  return (response.Result ?? response) as T;
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function callArkJson<T>(action: string, body: Record<string, unknown>) {
  const service = createArkService();
  const api = service.createJSONAPI(action, {
    Version: volcVersion,
    method: 'POST',
    contentType: 'json',
  });
  const raw = await api(body) as ArkOpenApiResponse<T>;
  const result = resultOf<T>(raw);
  return { raw, result };
}

function failureReasonOf(asset: VolcengineRealPersonAssetResult) {
  return [asset.Error?.Code, asset.Error?.Message].filter(Boolean).join('：');
}

export const volcengineRealPersonClient = {
  async createVisualValidateSession(input: {
    callbackUrl: string;
    projectName?: string;
  }): Promise<CreateVisualValidateSessionResponse> {
    const projectName = projectNameOf(input.projectName);
    const callbackUrl = input.callbackUrl.trim();
    if (!callbackUrl) {
      throw new Error('缺少火山真人认证回调地址');
    }
    const response = await callArkJson<CreateVisualValidateSessionResult>('CreateVisualValidateSession', {
      CallbackURL: callbackUrl,
      ProjectName: projectName,
    });
    const bytedToken = stringField(response.result.BytedToken);
    const h5Link = stringField(response.result.H5Link);
    if (!bytedToken || !h5Link) {
      throw new Error('火山真人认证会话响应缺少 BytedToken 或 H5Link');
    }
    return {
      ...response,
      bytedToken,
      h5Link,
      callbackUrl: stringField(response.result.CallbackURL) || callbackUrl,
      projectName,
    };
  },

  async getVisualValidateResult(input: {
    bytedToken: string;
    projectName?: string;
  }): Promise<GetVisualValidateResultResponse> {
    const projectName = projectNameOf(input.projectName);
    const bytedToken = input.bytedToken.trim();
    if (!bytedToken) {
      throw new Error('缺少真人认证 BytedToken');
    }
    const response = await callArkJson<GetVisualValidateResultResult>('GetVisualValidateResult', {
      BytedToken: bytedToken,
      ProjectName: projectName,
    });
    const groupId = stringField(response.result.GroupId);
    if (!groupId) {
      throw new Error('火山真人认证结果缺少 GroupId');
    }
    return { ...response, groupId, projectName };
  },

  async createAsset(input: {
    groupId: string;
    url: string;
    name: string;
    assetType: RealPersonAssetType;
    projectName?: string;
  }): Promise<CreateRealPersonAssetResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<CreateAssetResult>('CreateAsset', {
      GroupId: input.groupId,
      URL: input.url,
      Name: input.name.slice(0, 64),
      AssetType: input.assetType,
      ProjectName: projectName,
    });
    const assetId = stringField(response.result.Id);
    if (!assetId) {
      throw new Error('火山真人素材创建响应缺少 Asset ID');
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
  }): Promise<GetRealPersonAssetResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<VolcengineRealPersonAssetResult>('GetAsset', {
      Id: input.assetId,
      ProjectName: projectName,
    });
    const assetId = stringField(response.result.Id) || input.assetId;
    const status = stringField(response.result.Status) || 'Processing';
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
    assetType?: RealPersonAssetType;
    pageToken?: string;
    pageSize?: number;
    projectName?: string;
  } = {}): Promise<ListRealPersonAssetsResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<ListAssetsResult>('ListAssets', {
      GroupId: input.groupId,
      Name: input.name,
      AssetType: input.assetType,
      PageToken: input.pageToken,
      PageSize: input.pageSize,
      ProjectName: projectName,
    });
    const assets = Array.isArray(response.result.Assets)
      ? response.result.Assets
      : Array.isArray(response.result.Items)
        ? response.result.Items
        : [];
    return { ...response, assets, projectName };
  },

  async deleteAsset(input: {
    assetId: string;
    projectName?: string;
  }): Promise<DeleteRealPersonAssetResponse> {
    const projectName = projectNameOf(input.projectName);
    const response = await callArkJson<DeleteAssetResult>('DeleteAsset', {
      Id: input.assetId,
      ProjectName: projectName,
    });
    return { ...response, projectName };
  },
};

export function isVolcengineRealPersonAssetMissingError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /(not\s*found|不存在|does\s*not\s*exist|notexist|not\s*exist|404)/i.test(error.message);
}
