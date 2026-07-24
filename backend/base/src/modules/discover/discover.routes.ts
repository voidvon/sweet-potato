import { Router } from 'express'
import { requireAdmin } from '../../shared/auth.middleware.js'
import { getErrorMessage, sendError } from '../../shared/http.js'
import { discoverService } from './discover.service.js'

export function createDiscoverRouter() {
  const router = Router()
  router.get('/categories', (_req, res) => res.json({ items: discoverService.listCategories().filter((item) => item.status === 'active') }))
  router.get('/items', (req, res) => res.json(discoverService.listPublicItems(req.query)))
  router.post('/items/:id/like', (req, res) => {
    const counts = discoverService.likeItem(req.params.id)
    return counts ? res.json(counts) : sendError(res, 404, '发现条目不存在')
  })
  router.post('/items/:id/view', (req, res) => {
    const counts = discoverService.viewItem(req.params.id)
    return counts ? res.json(counts) : sendError(res, 404, '发现条目不存在')
  })
  return router
}

export function createAdminDiscoverRouter() {
  const router = Router()
  router.use(requireAdmin)
  router.get('/categories', (_req, res) => res.json({ items: discoverService.listCategories() }))
  router.get('/items', (req, res) => res.json({ items: discoverService.listItems(req.query) }))
  router.post('/categories', (req, res) => { try { res.status(201).json(discoverService.createCategory(req.body || {})) } catch (e) { sendError(res, 400, getErrorMessage(e, '分类创建失败')) } })
  router.patch('/categories/:id', (req, res) => { try { const item = discoverService.updateCategory(req.params.id, req.body || {}); if (!item) return sendError(res, 404, '分类不存在'); return res.json(item) } catch (e) { return sendError(res, 400, getErrorMessage(e, '分类更新失败')) } })
  router.delete('/categories/:id', (req, res) => { try { discoverService.deleteCategory(req.params.id); res.json({ ok: true }) } catch (e) { sendError(res, 400, getErrorMessage(e, '分类删除失败')) } })
  router.post('/items', (req, res) => { try { res.status(201).json(discoverService.createItem(req.body || {})) } catch (e) { sendError(res, 400, getErrorMessage(e, '发现条目创建失败')) } })
  router.patch('/items/:id', (req, res) => { try { res.json(discoverService.updateItem(req.params.id, req.body || {})) } catch (e) { sendError(res, 400, getErrorMessage(e, '发现条目更新失败')) } })
  router.delete('/items/:id', (req, res) => { try { discoverService.deleteItem(req.params.id); res.json({ ok: true }) } catch (e) { sendError(res, 400, getErrorMessage(e, '发现条目删除失败')) } })
  return router
}
