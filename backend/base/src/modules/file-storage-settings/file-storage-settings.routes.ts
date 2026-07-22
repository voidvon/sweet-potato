import { Router } from 'express'
import { requireAdmin } from '../../shared/auth.middleware.js'
import { sendError } from '../../shared/http.js'
import { fileStorageSettingsService } from './file-storage-settings.service.js'

export function createFileStorageSettingsRouter() {
  const router = Router()
  router.use(requireAdmin)

  router.get('/', (_req, res) => {
    res.json(fileStorageSettingsService.getSettings())
  })

  router.put('/', (req, res) => {
    try {
      res.json(fileStorageSettingsService.updateSettings(req.body || {}))
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '文件存储设置保存失败')
    }
  })

  return router
}
