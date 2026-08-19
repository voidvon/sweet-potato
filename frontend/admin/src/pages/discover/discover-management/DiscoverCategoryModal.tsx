import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Popconfirm, Space, Table, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import {
  createDiscoverCategory,
  deleteDiscoverCategory,
  updateDiscoverCategory,
  type DiscoverCategory,
} from '../../../api/discover'

type DiscoverCategoryModalProps = {
  categories: DiscoverCategory[]
  open: boolean
  onChanged: () => Promise<void>
  onClose: () => void
  onReordered: (categories: DiscoverCategory[]) => void
}

export function DiscoverCategoryModal({ categories, open, onChanged, onClose, onReordered }: DiscoverCategoryModalProps) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string>()
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [sorting, setSorting] = useState(false)

  async function addCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    setSaving(true)
    try {
      await createDiscoverCategory({ name })
      setNewCategoryName('')
      await onChanged()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveCategory(category: DiscoverCategory) {
    const name = editingCategoryName.trim()
    if (!name) return
    setSaving(true)
    try {
      await updateDiscoverCategory(category.id, { name })
      setEditingCategoryId(undefined)
      await onChanged()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类更新失败')
    } finally {
      setSaving(false)
    }
  }

  async function moveCategory(categoryId: string, direction: -1 | 1) {
    const currentIndex = categories.findIndex((category) => category.id === categoryId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return

    const reordered = [...categories]
    ;[reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[currentIndex]!]
    const normalized = reordered.map((category, index) => ({ ...category, sortOrder: index * 10 }))
    setSorting(true)
    try {
      await Promise.all(normalized.map((category) => updateDiscoverCategory(category.id, { sortOrder: category.sortOrder })))
      onReordered(normalized)
      message.success('分类顺序已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分类排序失败')
      await onChanged()
    } finally {
      setSorting(false)
    }
  }

  const columns = useMemo<ColumnsType<DiscoverCategory>>(() => [
    {
      title: '分类名称',
      dataIndex: 'name',
      render: (name: string, category) => editingCategoryId === category.id
        ? <Input autoFocus maxLength={40} onChange={(event) => setEditingCategoryName(event.target.value)} onPressEnter={() => void saveCategory(category)} value={editingCategoryName} />
        : name,
    },
    { title: '标识', dataIndex: 'slug', width: 180 },
    {
      title: '排序',
      width: 100,
      render: (_, category, index) => (
        <Space size={0}>
          <Tooltip title="上移">
            <Button aria-label="上移分类" disabled={sorting || index === 0} icon={<ArrowUpOutlined />} onClick={() => void moveCategory(category.id, -1)} type="text" />
          </Tooltip>
          <Tooltip title="下移">
            <Button aria-label="下移分类" disabled={sorting || index === categories.length - 1} icon={<ArrowDownOutlined />} onClick={() => void moveCategory(category.id, 1)} type="text" />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 180,
      render: (_, category) => editingCategoryId === category.id ? (
        <Space size={4}>
          <Button loading={saving} onClick={() => void saveCategory(category)} type="link">保存</Button>
          <Button onClick={() => setEditingCategoryId(undefined)} type="link">取消</Button>
        </Space>
      ) : (
        <Space size={4}>
          <Button icon={<EditOutlined />} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name) }} type="link">编辑</Button>
          <Popconfirm
            description="分类下有作品时无法删除"
            onConfirm={async () => {
              try {
                await deleteDiscoverCategory(category.id)
                await onChanged()
              } catch (error) {
                message.error(error instanceof Error ? error.message : '分类删除失败')
              }
            }}
            title="确认删除该分类？"
          >
            <Button danger icon={<DeleteOutlined />} type="link">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [categories.length, editingCategoryId, editingCategoryName, saving, sorting])

  return (
    <Modal footer={null} onCancel={onClose} open={open} title="分类管理" width={720}>
      <Space.Compact className="discover-category-create">
        <Input maxLength={40} onChange={(event) => setNewCategoryName(event.target.value)} onPressEnter={() => void addCategory()} placeholder="输入分类名称" value={newCategoryName} />
        <Button loading={saving} onClick={() => void addCategory()} type="primary">新增分类</Button>
      </Space.Compact>
      <Table columns={columns} dataSource={categories} pagination={false} rowKey="id" size="small" />
    </Modal>
  )
}
