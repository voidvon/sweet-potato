import { volcengineTosConfig } from '../../config/env.js'
import {
  setFileStorageProviderResolver,
  setTosStorageConfigResolver,
} from '../../shared/file-storage.js'
import {
  fileStorageSettingsRepository,
  type FileStorageSettingsRecord,
} from './file-storage-settings.repository.js'

let cachedSettings: FileStorageSettingsRecord | null = null

function environmentDefaults(): FileStorageSettingsRecord {
  return {
    enabled: String(process.env.FILE_STORAGE_PROVIDER || '').trim().toLowerCase() === 'tos',
    endpoint: volcengineTosConfig.endpoint,
    bucket: volcengineTosConfig.bucket,
    region: volcengineTosConfig.region,
    accessKey: volcengineTosConfig.accessKey,
    secretKey: volcengineTosConfig.secretKey,
    publicBaseUrl: volcengineTosConfig.publicBaseUrl,
    keyPrefix: String(
      process.env.FILE_STORAGE_KEY_PREFIX
      || process.env.VOLCENGINE_TOS_KEY_PREFIX
      || 'app-files',
    ).trim() || 'app-files',
  }
}

function runtimeSettings() {
  if (!cachedSettings) {
    cachedSettings = fileStorageSettingsRepository.get(environmentDefaults())
  }
  return cachedSettings
}

function text(value: unknown) {
  return String(value || '').trim()
}

function assertHttpUrl(value: string, fieldName: string, required: boolean) {
  if (!value && !required) return
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    throw new Error(`${fieldName}必须是有效的 HTTP(S) 地址`)
  }
}

function publicSettings(settings: FileStorageSettingsRecord) {
  return {
    ...settings,
    secretKey: '',
    secretKeyConfigured: Boolean(settings.secretKey),
    provider: settings.enabled ? 'tos' as const : 'local' as const,
  }
}

export const fileStorageSettingsService = {
  getRuntimeSettings() {
    return runtimeSettings()
  },

  getSettings() {
    return publicSettings(runtimeSettings())
  },

  updateSettings(input: Record<string, unknown>) {
    const current = runtimeSettings()
    const enabled = input.enabled === true
    const endpoint = text(input.endpoint)
    const bucket = text(input.bucket)
    const region = text(input.region) || 'cn-beijing'
    const accessKey = text(input.accessKey)
    const secretKey = text(input.secretKey) || current.secretKey
    const publicBaseUrl = text(input.publicBaseUrl).replace(/\/+$/, '')
    const keyPrefix = text(input.keyPrefix).replace(/^\/+|\/+$/g, '') || 'app-files'

    if (enabled) {
      assertHttpUrl(endpoint, 'TOS 服务地址', true)
      if (!bucket) throw new Error('请输入存储桶名称')
      if (!region) throw new Error('请输入地区')
      if (!accessKey) throw new Error('请输入 Access Key ID')
      if (!secretKey) throw new Error('请输入 Secret Access Key')
    }
    assertHttpUrl(publicBaseUrl, '访问域名', false)
    if (keyPrefix.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error('存储路径前缀不能包含 . 或 .. 路径段')
    }

    cachedSettings = fileStorageSettingsRepository.update({
      enabled,
      endpoint,
      bucket,
      region,
      accessKey,
      secretKey,
      publicBaseUrl,
      keyPrefix,
    })
    return publicSettings(cachedSettings)
  },
}

setFileStorageProviderResolver(() => fileStorageSettingsService.getRuntimeSettings().enabled ? 'tos' : 'local')
setTosStorageConfigResolver(() => fileStorageSettingsService.getRuntimeSettings())
