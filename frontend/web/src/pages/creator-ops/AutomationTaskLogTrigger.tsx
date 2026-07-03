import { useMemo, useState } from 'react';
import { Button, Popover, Tag } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { AutomationTask } from '../../ipc';
import './AutomationTaskLogTrigger.scss';

type AutomationTaskLogTriggerProps = {
  emptyText?: string;
  label: string;
  task: AutomationTask | null;
};

function getTaskStatusText(task: AutomationTask | null) {
  if (!task) {
    return '未执行';
  }

  switch (task.status) {
    case 'created':
      return '已创建';
    case 'running':
      return '执行中';
    case 'waiting_user':
      return '等待处理';
    case 'done':
      return '已完成';
    case 'failed':
      return '执行失败';
    case 'canceled':
      return '已取消';
    default:
      return task.status;
  }
}

function getTaskStatusTagColor(task: AutomationTask | null) {
  if (!task) {
    return 'default';
  }

  switch (task.status) {
    case 'done':
      return 'success';
    case 'failed':
      return 'error';
    case 'canceled':
      return 'warning';
    case 'running':
    case 'waiting_user':
      return 'processing';
    default:
      return 'default';
  }
}

function getTriggerClassName(task: AutomationTask | null) {
  const status = task?.status ? ` is-${task.status}` : '';
  return `automation-task-log-trigger${status}`;
}

export function AutomationTaskLogTrigger({
  emptyText = '暂无自动化日志',
  label,
  task,
}: AutomationTaskLogTriggerProps) {
  const [open, setOpen] = useState(false);

  const content = useMemo(() => {
    const logs = task?.logs.slice(-12) || [];

    return (
      <div className="automation-task-log-popover">
        {task ? (
          <>
            <div className="automation-task-log-popover-header">
              <span>{label}</span>
              <Tag color={getTaskStatusTagColor(task)}>
                {getTaskStatusText(task)}
              </Tag>
            </div>
            <div>Task ID: {task.id}</div>
            <div>Profile: {task.profileId}</div>
            {task.error ? <div>错误: {task.error}</div> : null}
          </>
        ) : (
          <div className="automation-task-log-popover-header">
            <span>{label}</span>
          </div>
        )}

        {logs.length ? (
          <div className="automation-task-log-lines">
            {logs.map((log) => (
              <div key={`${log.time}-${log.message}`}>
                [{log.level}] {log.message}
              </div>
            ))}
          </div>
        ) : null}

        {!task ? (
          <div className="automation-task-log-popover-empty">
            {emptyText}
          </div>
        ) : null}
      </div>
    );
  }, [emptyText, label, task]);

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={setOpen}
      open={open}
      placement="bottomRight"
      trigger={['hover', 'click']}
    >
      <Button
        aria-label={label}
        className={getTriggerClassName(task)}
        icon={<InfoCircleOutlined />}
        shape="circle"
        type="text"
      />
    </Popover>
  );
}
