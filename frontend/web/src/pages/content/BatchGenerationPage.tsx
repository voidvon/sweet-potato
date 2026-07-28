import { useMemo, useState } from 'react';
import { Button, Dropdown, Input, Select, Tabs } from 'antd';
import type { MenuProps } from 'antd';
import {
  Check,
  ChevronDown,
  Columns3,
  Copy,
  ImagePlus,
  Plus,
  Rows3,
} from 'lucide-react';
import './BatchGenerationPage.scss';

const MAX_ROWS = 200;

type SheetRow = {
  id: string;
  prompt: string;
  referenceImage?: string;
  status: 'pending' | 'completed' | 'processing' | 'failed';
};

type SheetTab = {
  id: string;
  name: string;
  type: '图片' | '视频';
};

const initialTabs: SheetTab[] = [
  { id: 'sheet-1', name: '换装-202607101909', type: '图片' },
  { id: 'sheet-2', name: '对话生图-20260710190942', type: '图片' },
];

const initialRows: SheetRow[] = [{ id: 'row-1', prompt: '', status: 'pending' }];

function newRow(index: number): SheetRow {
  return { id: `row-${Date.now()}-${index}`, prompt: '', status: 'pending' };
}

export function BatchGenerationPage() {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[1].id);
  const [rows, setRows] = useState(initialRows);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(true);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const selectedRows = rows.filter((row) => selectedRowIds.includes(row.id));
  const rowStats = useMemo(() => ({
    completed: rows.filter((row) => row.status === 'completed').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    processing: rows.filter((row) => row.status === 'processing').length,
  }), [rows]);

  const markChanged = () => setHasUnsavedChanges(true);

  const updatePrompt = (id: string, prompt: string) => {
    setRows((currentRows) => currentRows.map((row) => (row.id === id ? { ...row, prompt } : row)));
    markChanged();
  };

  const addRow = () => {
    if (rows.length >= MAX_ROWS) return;
    setRows((currentRows) => [...currentRows, newRow(currentRows.length + 1)]);
    markChanged();
  };

  const copySelectedRows = () => {
    if (selectedRows.length === 0 || rows.length >= MAX_ROWS) return;
    setRows((currentRows) => [
      ...currentRows,
      ...selectedRows.slice(0, MAX_ROWS - currentRows.length).map((row, index) => ({
        ...row,
        id: newRow(index).id,
        status: 'pending' as const,
      })),
    ]);
    markChanged();
  };

  const toggleRow = (id: string) => {
    setSelectedRowIds((currentIds) => (
      currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]
    ));
  };

  const toggleAllRows = () => {
    setSelectedRowIds(selectedRowIds.length === rows.length ? [] : rows.map((row) => row.id));
  };

  const addSheet = () => {
    const id = `sheet-${Date.now()}`;
    setTabs((currentTabs) => [...currentTabs, { id, name: `表格-${currentTabs.length + 1}`, type: '图片' }]);
    setActiveTabId(id);
    markChanged();
  };

  const removeSheet = (id: string) => {
    if (tabs.length === 1) return;
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    setTabs(nextTabs);
    if (id === activeTabId) setActiveTabId(nextTabs[0].id);
    markChanged();
  };

  const titleMenu: MenuProps['items'] = tabs.map((tab) => ({
    key: tab.id,
    label: tab.name,
    onClick: () => setActiveTabId(tab.id),
  }));

  return (
    <main className="sheet-workspace">
      <header className="sheet-workspace__header">
        <div className="sheet-workspace__breadcrumb">
          <span className="sheet-workspace__dot" />
          <span>表格</span>
          <span className="sheet-workspace__slash">/</span>
          <Dropdown menu={{ items: titleMenu }} trigger={['click']}>
            <button className="sheet-workspace__title-button" type="button">
              <strong>{activeTab?.name}</strong>
              <ChevronDown size={18} />
            </button>
          </Dropdown>
          <span className="sheet-workspace__slash">/</span>
          <span className="sheet-workspace__new-state"><span className="sheet-workspace__state-dot" />新建</span>
        </div>
        <div className="sheet-workspace__header-actions">
          <Button disabled>重试所有失败</Button>
          <Button disabled type="primary">批量执行</Button>
          <Button icon={<Check size={16} />} onClick={() => setHasUnsavedChanges(false)} type="primary">保存</Button>
        </div>
      </header>

      <Tabs
        activeKey={activeTabId}
        className="sheet-workspace__tabs"
        items={tabs.map((tab) => ({
          closable: tabs.length > 1,
          key: tab.id,
          label: `${tab.name} · ${tab.type}`,
        }))}
        onChange={setActiveTabId}
        onEdit={(targetKey, action) => {
          if (action === 'add') {
            addSheet();
          } else if (typeof targetKey === 'string') {
            removeSheet(targetKey);
          }
        }}
        type="editable-card"
      />

      <section className="sheet-global-settings" aria-label="全局参数">
        <div className="sheet-global-settings__intro">
          <strong>全局参数</strong>
          <span>应用到所有行，行内可覆盖</span>
        </div>
        <div className="sheet-global-settings__divider" />
        <label>模型
          <Select defaultValue="qianfan-max" bordered={false} options={[{ label: '千禧灵感 Max', value: 'qianfan-max' }]} suffixIcon={<ChevronDown size={17} />} />
        </label>
        <Select className="sheet-global-settings__resolution" defaultValue="auto-2k" bordered={false} options={[{ label: 'auto · 2K', value: 'auto-2k' }]} suffixIcon={<ChevronDown size={17} />} />
        <label>出图张数
          <Select defaultValue="1" bordered={false} options={[{ label: '1张', value: '1' }]} suffixIcon={<ChevronDown size={17} />} />
        </label>
      </section>

      <section className="sheet-toolbar" aria-label="表格工具栏">
        <span>{rows.length} / {MAX_ROWS} 行</span>
        <i />
        <Button icon={<Plus size={17} />} onClick={addRow} type="text">新增行</Button>
        <Button disabled={selectedRows.length === 0 || rows.length >= MAX_ROWS} icon={<Copy size={17} />} onClick={copySelectedRows} type="text">复制</Button>
        <i />
        <Button disabled icon={<Rows3 size={17} />} type="text">行高</Button>
        <Button disabled icon={<Columns3 size={17} />} type="text">列宽</Button>
      </section>

      <section className="sheet-grid" aria-label="图片批量生成表格">
        <div className="sheet-grid__header">
          <button aria-label="选择全部行" className={`sheet-checkbox${selectedRowIds.length === rows.length ? ' is-checked' : ''}`} onClick={toggleAllRows} type="button">
            {selectedRowIds.length === rows.length && <Check size={15} />}
          </button>
          <span>#</span>
          <strong>提示词 <b>*</b></strong>
          <span>参考图</span>
        </div>
        <div className="sheet-grid__rows">
          {rows.map((row, index) => (
            <div className="sheet-grid__row" key={row.id}>
              <button aria-label={`选择第 ${index + 1} 行`} className={`sheet-checkbox${selectedRowIds.includes(row.id) ? ' is-checked' : ''}`} onClick={() => toggleRow(row.id)} type="button">
                {selectedRowIds.includes(row.id) && <Check size={15} />}
              </button>
              <span className="sheet-grid__index">{index + 1}</span>
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 5 }}
                className="sheet-grid__prompt"
                onChange={(event) => updatePrompt(row.id, event.target.value)}
                placeholder="参考 @图1 @图2 描述你想生成的画面"
                value={row.prompt}
              />
              <button aria-label="添加参考图" className="sheet-grid__reference" type="button"><ImagePlus size={24} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="sheet-add-row">
        <Button disabled={rows.length >= MAX_ROWS} icon={<Plus size={20} />} onClick={addRow} size="large" type="dashed">新增一行</Button>
      </section>

      <section className="sheet-remaining">剩余可添加 <strong>{MAX_ROWS - rows.length}</strong> / {MAX_ROWS}</section>

      <footer className="sheet-task-stats">
        <span>共 <strong>{rows.length}</strong> 行</span>
        <i />
        <span className="sheet-task-stats__done">● 完成 <strong>{rowStats.completed}</strong></span>
        <span className="sheet-task-stats__processing">● 处理中 <strong>{rowStats.processing}</strong></span>
        <span className="sheet-task-stats__failed">● 失败 <strong>{rowStats.failed}</strong></span>
        <span className="sheet-task-stats__pending">● 待提交 <strong>{rowStats.pending}</strong></span>
        {hasUnsavedChanges && <><i /><span className="sheet-task-stats__unsaved">有未保存的改动</span></>}
      </footer>
    </main>
  );
}
