import { managedFilePublicUrl } from '../file-management/file-management.service.js'
import { adminWorkRepository } from './admin-work.repository.js'

function optionalText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

export const adminWorkService = {
  list(input: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(input.page || 1)))
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize || 20))))
    const result = adminWorkRepository.list({
      page,
      pageSize,
      username: optionalText(input.username),
      search: optionalText(input.search),
    })
    return {
      ...result,
      items: result.items.map((work) => ({
        ...work,
        fileUrl: managedFilePublicUrl({ fileUrl: work.fileUrl, storageProvider: work.fileUrl.startsWith('http') ? 'tos' : 'local' }),
      })),
    }
  },
}
