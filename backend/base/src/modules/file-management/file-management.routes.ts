import { Router } from 'express'
import { requirePermission } from '../../shared/auth.middleware.js'
import { getErrorMessage, sendError } from '../../shared/http.js'
import { fileManagementService } from './file-management.service.js'
import { fileManagementTosService } from './file-management-tos.service.js'

export function createFileManagementRouter() {
  const router = Router()
  router.use(requirePermission('admin.route.system.file_management.view'))

  router.get('/tos-summary', (_req, res) => {
    void fileManagementTosService.getSummary()
      .then((summary) => res.json(summary))
      .catch((error) => sendError(res, 502, getErrorMessage(error, 'TOS 存储容量读取失败')))
  })

  router.get('/tos-objects', (req, res) => {
    void fileManagementTosService.list(req.query)
      .then((result) => res.json(result))
      .catch((error) => sendError(res, 502, getErrorMessage(error, 'TOS 文件列表读取失败')))
  })

  router.get('/', (req, res) => {
    try {
      res.json(fileManagementService.list(req.query))
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '文件列表获取失败'))
    }
  })

  router.post('/delete', (req, res) => {
    void fileManagementService.delete(req.body || {})
      .then((result) => res.json(result))
      .catch((error) => sendError(res, 400, getErrorMessage(error, '文件删除失败')))
  })

  return router
}
