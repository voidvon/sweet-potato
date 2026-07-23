import { Router } from 'express'
import { requireAdmin } from '../../shared/auth.middleware.js'
import { getErrorMessage, sendError } from '../../shared/http.js'
import { adminWorkService } from './admin-work.service.js'

export function createAdminWorkRouter() {
  const router = Router()
  router.use(requireAdmin)

  router.get('/', (req, res) => {
    try {
      res.json(adminWorkService.list(req.query))
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '作品列表获取失败'))
    }
  })

  return router
}
