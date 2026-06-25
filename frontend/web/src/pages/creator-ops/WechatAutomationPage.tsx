import { useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  isElectronEgg,
  openWechatAddFriend,
  type WechatAutomationActionResult,
  type WechatAutomationLog,
} from '../../ipc';
import './WechatAutomationPage.scss';

type ExecutionState = {
  actionLabel: string | null;
  result: WechatAutomationActionResult | null;
};

const DEFAULT_WINDOW_NAME = '微信';

function renderLogs(logs?: WechatAutomationLog[]) {
  if (!logs?.length) {
    return <Empty description="还没有执行日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className="wechat-automation-logs">
      {logs.map((log, index) => (
        <div className={`wechat-automation-log wechat-automation-log-${log.level}`} key={`${log.level}-${index}`}>
          <Tag color={log.level === 'error' ? 'red' : log.level === 'warn' ? 'gold' : 'blue'}>
            {log.level.toUpperCase()}
          </Tag>
          <span>{log.message}</span>
        </div>
      ))}
    </div>
  );
}

export function WechatAutomationPage() {
  const [account, setAccount] = useState('');
  const [greeting, setGreeting] = useState('');
  const [submitRunning, setSubmitRunning] = useState(false);
  const [executionState, setExecutionState] = useState<ExecutionState>({
    actionLabel: null,
    result: null,
  });

  function updateExecutionResult(actionLabel: string, result: WechatAutomationActionResult) {
    setExecutionState({
      actionLabel,
      result,
    });
  }

  async function handleSubmitAddFriend() {
    if (!account.trim()) {
      message.error('请输入微信号或手机号');
      return;
    }
    if (!greeting.trim()) {
      message.error('请输入打招呼内容');
      return;
    }

    setSubmitRunning(true);
    const result = await openWechatAddFriend({
      windowName: DEFAULT_WINDOW_NAME,
      account: account.trim(),
      greeting,
    });
    setSubmitRunning(false);
    updateExecutionResult('完成微信添加', result);

    if (!result.ok) {
      message.error(result.message || '微信添加流程执行失败');
      return;
    }
    message.success(result.message || '微信添加流程已执行');
  }

  return (
    <ContentStudioLayout>
      <div className="wechat-automation-page">
        {!isElectronEgg ? (
          <Alert
            showIcon
            type="warning"
            message="当前不是 Electron 环境"
            description="微信自动化依赖本地 Electron IPC，浏览器模式下不会执行微信自动化。"
          />
        ) : null}

        <Card className="wechat-automation-card" title="微信添加">
          <Space className="wechat-automation-toolbar" direction="vertical" size={16}>
            <Typography.Text type="secondary">
              自动执行完整链路：点击“快捷操作” - 点击“添加朋友” - 搜索微信号/手机号 - 输入打招呼内容 - 完成发送。
            </Typography.Text>

            <div className="wechat-automation-form-grid">
              <Input
                onChange={(event) => setAccount(event.target.value)}
                placeholder="输入微信号或手机号"
                value={account}
              />
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(event) => setGreeting(event.target.value)}
                placeholder="输入打招呼内容"
                value={greeting}
              />
            </div>

            <div className="wechat-automation-actions">
              <Button
                icon={<UserAddOutlined />}
                loading={submitRunning}
                onClick={() => void handleSubmitAddFriend()}
                type="primary"
              >
                完成微信添加
              </Button>
              <Button
                disabled={submitRunning}
                icon={<ReloadOutlined />}
                onClick={() => setExecutionState({ actionLabel: null, result: null })}
              >
                清空执行结果
              </Button>
            </div>
          </Space>
        </Card>

        <Card className="wechat-automation-card" title={executionState.actionLabel ? `${executionState.actionLabel}日志` : '执行日志'}>
          {executionState.result?.ok ? (
            <Space className="wechat-automation-result" direction="vertical" size={16}>
              <Alert
                showIcon
                type="success"
                message={executionState.result.message || '自动化流程已执行'}
                description={executionState.actionLabel ? `最近一次操作: ${executionState.actionLabel}` : undefined}
              />
              {renderLogs(executionState.result.logs)}
              {executionState.result.command?.length ? (
                <Typography.Paragraph className="wechat-automation-command" type="secondary">
                  执行命令: {executionState.result.command.join(' ')}
                </Typography.Paragraph>
              ) : null}
              {executionState.result.data ? (
                <div className="wechat-automation-command">
                  <pre>{JSON.stringify(executionState.result.data, null, 2)}</pre>
                </div>
              ) : null}
            </Space>
          ) : executionState.result && !executionState.result.ok ? (
            <Space className="wechat-automation-result" direction="vertical" size={16}>
              <Alert
                showIcon
                type="error"
                message={executionState.actionLabel ? `${executionState.actionLabel}失败` : '执行失败'}
                description={executionState.result.message || '未返回可用错误信息'}
              />
              {renderLogs(executionState.result.logs)}
              {executionState.result.data ? (
                <div className="wechat-automation-command">
                  <pre>{JSON.stringify(executionState.result.data, null, 2)}</pre>
                </div>
              ) : null}
            </Space>
          ) : (
            <Empty description="还没有执行记录" />
          )}
        </Card>
      </div>
    </ContentStudioLayout>
  );
}
