import path from 'node:path'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { TosClient } from '@volcengine/tos-sdk'
import { volcengineTosConfig } from '../config/env.js'

export type FileStorageProviderName = 'local' | 'tos'

export type TosStorageConfig = {
  accessKey: string
  secretKey: string
  region: string
  endpoint: string
  bucket: string
  publicBaseUrl: string
  keyPrefix: string
}

export type StoredFile = {
  provider: FileStorageProviderName
  key: string
  filePath: string
  fileUrl: string
  bucket?: string
}

export type StoredFileMetadata = {
  storageProvider: FileStorageProviderName
  storageKey: string
  storageBucket?: string
}

type StoreLocalFileInput = {
  key: string
  filePath: string
  fileUrl: string
  mimeType?: string
}

export interface FileStorageProvider {
  readonly name: FileStorageProviderName
  storeLocalFile(input: StoreLocalFileInput & { key: string }): Promise<StoredFile>
  deleteObject(key: string, bucket?: string): Promise<void>
}

type StorageProviderResolver = () => FileStorageProviderName | Promise<FileStorageProviderName>
type TosStorageConfigResolver = () => TosStorageConfig

function normalizeProvider(value: unknown): FileStorageProviderName {
  return String(value || '').trim().toLowerCase() === 'tos' ? 'tos' : 'local'
}

let providerResolver: StorageProviderResolver = () => normalizeProvider(process.env.FILE_STORAGE_PROVIDER)
let tosStorageConfigResolver: TosStorageConfigResolver = () => ({
  accessKey: volcengineTosConfig.accessKey,
  secretKey: volcengineTosConfig.secretKey,
  region: volcengineTosConfig.region,
  endpoint: volcengineTosConfig.endpoint,
  bucket: volcengineTosConfig.bucket,
  publicBaseUrl: volcengineTosConfig.publicBaseUrl,
  keyPrefix: String(
    process.env.FILE_STORAGE_KEY_PREFIX
    || process.env.VOLCENGINE_TOS_KEY_PREFIX
    || 'app-files',
  ).trim().replace(/^\/+|\/+$/g, ''),
})

export function setFileStorageProviderResolver(resolver: StorageProviderResolver) {
  providerResolver = resolver
}

export function setTosStorageConfigResolver(resolver: TosStorageConfigResolver) {
  tosStorageConfigResolver = resolver
  cachedTosClient = null
  cachedTosClientFingerprint = ''
}

export function currentTosStorageConfig() {
  return tosStorageConfigResolver()
}

export async function currentFileStorageProvider() {
  return normalizeProvider(await providerResolver())
}

export function fileStorageKey(relativePath: string) {
  const prefix = currentTosStorageConfig().keyPrefix
  return [prefix, normalizeStorageKey(relativePath)].filter(Boolean).join('/')
}

function normalizeStorageKey(value: string) {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('文件存储 key 无效')
  }
  return normalized
}

function normalizeTosEndpoint(endpoint: string) {
  return endpoint.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

function assertTosConfigured(config: TosStorageConfig) {
  if (!config.accessKey || !config.secretKey) {
    throw new Error('缺少火山 TOS 配置：请配置 VOLC_ACCESSKEY 和 VOLC_SECRETKEY')
  }
  if (!config.endpoint) {
    throw new Error('缺少火山 TOS 配置：请配置 VOLCENGINE_TOS_ENDPOINT')
  }
  if (!config.bucket) {
    throw new Error('缺少火山 TOS 配置：请配置 VOLCENGINE_TOS_BUCKET')
  }
}

let cachedTosClient: TosClient | null = null
let cachedTosClientFingerprint = ''

export function tosClient() {
  const config = currentTosStorageConfig()
  assertTosConfigured(config)
  const fingerprint = [config.accessKey, config.secretKey, config.region, config.endpoint].join('\n')
  if (!cachedTosClient || cachedTosClientFingerprint !== fingerprint) {
    cachedTosClient = new TosClient({
      accessKeyId: config.accessKey,
      accessKeySecret: config.secretKey,
      region: config.region,
      endpoint: normalizeTosEndpoint(config.endpoint),
    })
    cachedTosClientFingerprint = fingerprint
  }
  return cachedTosClient
}

export function tosPublicUrl(key: string) {
  const normalizedKey = normalizeStorageKey(key)
  const config = currentTosStorageConfig()
  let baseUrl = config.publicBaseUrl
  if (!baseUrl) {
    try {
      const endpoint = new URL(/^https?:\/\//i.test(config.endpoint) ? config.endpoint : `https://${config.endpoint}`)
      baseUrl = `${endpoint.protocol}//${config.bucket}.${endpoint.host}`
    } catch {
      baseUrl = ''
    }
  }
  if (!baseUrl) {
    throw new Error('火山 TOS 公网访问地址缺失：请配置 VOLCENGINE_TOS_PUBLIC_BASE_URL')
  }
  const encodedKey = normalizedKey.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `${baseUrl.replace(/\/+$/, '')}/${encodedKey}`
}

export async function putLocalFileToTos(input: { key: string; filePath: string; mimeType?: string }) {
  if (!input.filePath || !existsSync(input.filePath)) {
    throw new Error(`待上传文件不存在：${input.filePath}`)
  }
  const config = currentTosStorageConfig()
  const key = normalizeStorageKey(input.key)
  const response = await tosClient().putObjectFromFile({
    bucket: config.bucket,
    key,
    filePath: input.filePath,
    ...(input.mimeType ? { headers: { 'content-type': input.mimeType } } : {}),
  })
  return {
    bucket: config.bucket,
    key,
    publicUrl: tosPublicUrl(key),
    requestId: String(response.headers?.['x-tos-request-id'] || ''),
  }
}

export async function deleteTosObject(key: string, bucket = currentTosStorageConfig().bucket) {
  const normalizedKey = normalizeStorageKey(key)
  await tosClient().deleteObject({ bucket, key: normalizedKey })
}

export function createTosUploadUrl(input: { key: string; expiresInSeconds?: number }) {
  const config = currentTosStorageConfig()
  const key = normalizeStorageKey(input.key)
  return tosClient().getPreSignedUrl({
    bucket: config.bucket,
    key,
    method: 'PUT',
    expires: input.expiresInSeconds || 900,
  })
}

export async function headTosObject(key: string, bucket = currentTosStorageConfig().bucket) {
  const response = await tosClient().headObject({ bucket, key: normalizeStorageKey(key) })
  return {
    contentLength: Number(response.data['content-length'] || 0),
    contentType: String(response.data['content-type'] || ''),
  }
}

export function storageMetadata(file: StoredFile): StoredFileMetadata {
  return {
    storageProvider: file.provider,
    storageKey: file.key,
    ...(file.bucket ? { storageBucket: file.bucket } : {}),
  }
}

const localStorageProvider: FileStorageProvider = {
  name: 'local',
  async storeLocalFile(input) {
    return {
      provider: 'local',
      key: input.key,
      filePath: input.filePath,
      fileUrl: input.fileUrl,
    }
  },
  async deleteObject() {},
}

const tosStorageProvider: FileStorageProvider = {
  name: 'tos',
  async storeLocalFile(input) {
    const uploaded = await putLocalFileToTos(input)
    return {
      provider: 'tos',
      key: uploaded.key,
      bucket: uploaded.bucket,
      filePath: input.filePath,
      fileUrl: uploaded.publicUrl,
    }
  },
  async deleteObject(key, bucket) {
    await deleteTosObject(key, bucket)
  },
}

const storageProviders: Record<FileStorageProviderName, FileStorageProvider> = {
  local: localStorageProvider,
  tos: tosStorageProvider,
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

export const fileStorageService = {
  async storeLocalFile(input: StoreLocalFileInput): Promise<StoredFile> {
    const key = normalizeStorageKey(input.key)
    const provider = storageProviders[await currentFileStorageProvider()]
    return provider.storeLocalFile({ ...input, key })
  },

  async deleteStoredFile(input: { metadata?: Record<string, unknown>; filePath?: string }) {
    const provider = normalizeProvider(metadataString(input.metadata, 'storageProvider'))
    const key = metadataString(input.metadata, 'storageKey')
    const bucket = metadataString(input.metadata, 'storageBucket') || currentTosStorageConfig().bucket
    try {
      if (provider === 'tos' && key) {
        await storageProviders[provider].deleteObject(key, bucket)
      }
    } finally {
      if (input.filePath) {
        await rm(path.resolve(input.filePath), { force: true })
      }
    }
  },
}
