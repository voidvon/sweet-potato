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
import { t } from '@shared/i18n';

type DiscoverCategoryModalProps = {
  categories: DiscoverCategory[]
  open: boolean
  onChanged: () => Promise<void>
  onClose: () => void
  onReordered: (categories: DiscoverCategory[]) => void
}

export function DiscoverCategoryModal({ categories, open, onChanged, onClose, onReordered }: DiscoverCategoryModalProps) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryNameEN, setNewCategoryNameEN] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string>()
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [editingCategoryNameEN, setEditingCategoryNameEN] = useState('')
  const [saving, setSaving] = useState(false)
  const [sorting, setSorting] = useState(false)

  async function addCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    setSaving(true)
    try {
      await createDiscoverCategory({ name, nameEn: newCategoryNameEN.trim() })
      setNewCategoryName('')
      setNewCategoryNameEN('')
      await onChanged()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("分类创建失败"))
    } finally {
      setSaving(false)
    }
  }

  async function saveCategory(category: DiscoverCategory) {
    const name = editingCategoryName.trim()
    if (!name) return
    setSaving(true)
    try {
      await updateDiscoverCategory(category.id, { name, nameEn: editingCategoryNameEN.trim() })
      setEditingCategoryId(undefined)
      await onChanged()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("分类更新失败"))
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
      message.success(t("分类顺序已更新"))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("分类排序失败"))
      await onChanged()
    } finally {
      setSorting(false)
    }
  }

  const columns = useMemo<ColumnsType<DiscoverCategory>>(() => [
    {
      title: t("中文名称"),
      dataIndex: 'name',
      render: (name: string, category) => editingCategoryId === category.id
        ? <Input autoFocus maxLength={40} onChange={(event) => setEditingCategoryName(event.target.value)} onPressEnter={() => void saveCategory(category)} value={editingCategoryName} />
        : name,
    },
    {
      title: t("英文名称"),
      dataIndex: 'nameEn',
      render: (nameEn: string | undefined, category) => editingCategoryId === category.id
        ? <Input maxLength={40} onChange={(event) => setEditingCategoryNameEN(event.target.value)} onPressEnter={() => void saveCategory(category)} value={editingCategoryNameEN} />
        : nameEn || '-',
    },
    { title: t("标识"), dataIndex: 'slug', width: 180 },
    {
      title: t("排序"),
      width: 100,
      render: (_, category, index) => (
        <Space size={0}>
          <Tooltip title={t("上移")}>
            <Button aria-label={t("上移分类")} disabled={sorting || index === 0} icon={<ArrowUpOutlined />} onClick={() => void moveCategory(category.id, -1)} type="text" />
          </Tooltip>
          <Tooltip title={t("下移")}>
            <Button aria-label={t("下移分类")} disabled={sorting || index === categories.length - 1} icon={<ArrowDownOutlined />} onClick={() => void moveCategory(category.id, 1)} type="text" />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: t("操作"),
      width: 180,
      render: (_, category) => editingCategoryId === category.id ? (
        <Space size={4}>
          <Button loading={saving} onClick={() => void saveCategory(category)} type="link">{t("保存")}</Button>
          <Button onClick={() => setEditingCategoryId(undefined)} type="link">{t("取消")}</Button>
        </Space>
      ) : (
        <Space size={4}>
          <Button icon={<EditOutlined />} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); setEditingCategoryNameEN(category.nameEn || '') }} type="link">{t("编辑")}</Button>
          <Popconfirm
            description={t("分类下有作品时无法删除")}
            onConfirm={async () => {
              try {
                await deleteDiscoverCategory(category.id)
                await onChanged()
              } catch (error) {
                message.error(error instanceof Error ? error.message : t("分类删除失败"))
              }
            }}
            title={t("确认删除该分类？")}
          >
            <Button danger icon={<DeleteOutlined />} type="link">{t("删除")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [categories.length, editingCategoryId, editingCategoryName, editingCategoryNameEN, saving, sorting])

  return (
    <Modal footer={null} onCancel={onClose} open={open} title={t("分类管理")} width={900}>
      <Space.Compact className="discover-category-create">
        <Input maxLength={40} onChange={(event) => setNewCategoryName(event.target.value)} onPressEnter={() => void addCategory()} placeholder={t("输入中文名称")} value={newCategoryName} />
        <Input maxLength={40} onChange={(event) => setNewCategoryNameEN(event.target.value)} onPressEnter={() => void addCategory()} placeholder={t("输入英文名称（可选）")} value={newCategoryNameEN} />
        <Button loading={saving} onClick={() => void addCategory()} type="primary">{t("新增分类")}</Button>
      </Space.Compact>
      <Table columns={columns} dataSource={categories} pagination={false} rowKey="id" size="small" />
    </Modal>
  )
}
