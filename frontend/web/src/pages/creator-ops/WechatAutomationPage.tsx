import { useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  isElectronEgg,
  sendWechatMessage,
  type WechatAutomationLog,
  type WechatSendMessageResult,
} from '../../ipc';
import './WechatAutomationPage.scss';

type SendState = {
  running: boolean;
  result: WechatSendMessageResult | null;
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
  const [contactName, setContactName] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sendState, setSendState] = useState<SendState>({
    running: false,
    result: null,
  });

  async function handleSendMessage() {
    if (!contactName.trim()) {
      message.error('请输入联系人名称');
      return;
    }
    if (!messageText.trim()) {
      message.error('请输入消息内容');
      return;
    }

    setSendState((current) => ({ ...current, running: true }));
    const result = await sendWechatMessage({
      windowName: DEFAULT_WINDOW_NAME,
      contactName: contactName.trim(),
      message: messageText,
    });
    setSendState({
      running: false,
      result,
    });

    if (!result.ok) {
      message.error(result.message || '微信消息发送失败');
      return;
    }
    message.success(result.message || '微信发送流程已执行');
  }

  return (
    <ContentStudioLayout>
      <div className="wechat-automation-page">
        {!isElectronEgg ? (
          <Alert
            showIcon
            type="warning"
            message="当前不是 Electron 环境"
            description="微信自动化依赖本地 Electron IPC，浏览器模式下不会执行发送。"
          />
        ) : null}

        <Card className="wechat-automation-card" title="发送消息">
          <Space className="wechat-automation-toolbar" direction="vertical" size={16}>
            <div className="wechat-automation-form-grid">
              <Input
                onChange={(event) => setContactName(event.target.value)}
                placeholder="输入联系人名称"
                value={contactName}
              />
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 8 }}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="输入要发送的消息内容"
                value={messageText}
              />
            </div>

            <div className="wechat-automation-actions">
              <Button
                icon={<SendOutlined />}
                loading={sendState.running}
                onClick={() => void handleSendMessage()}
                type="primary"
              >
                搜索联系人并发送
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => setSendState({ running: false, result: null })}
              >
                清空发送结果
              </Button>
            </div>
          </Space>
        </Card>

        <Card className="wechat-automation-card" title="发送日志">
          {sendState.result?.ok ? (
            <Space className="wechat-automation-result" direction="vertical" size={16}>
              <Alert
                showIcon
                type="success"
                message={sendState.result.message || '消息发送流程已执行'}
              />
              {renderLogs(sendState.result.logs)}
              {sendState.result.command?.length ? (
                <Typography.Paragraph className="wechat-automation-command" type="secondary">
                  执行命令: {sendState.result.command.join(' ')}
                </Typography.Paragraph>
              ) : null}
            </Space>
          ) : sendState.result && !sendState.result.ok ? (
            <Space className="wechat-automation-result" direction="vertical" size={16}>
              <Alert
                showIcon
                type="error"
                message="发送失败"
                description={sendState.result.message || '未返回可用错误信息'}
              />
              {renderLogs(sendState.result.logs)}
            </Space>
          ) : (
            <Empty description="还没有执行消息发送" />
          )}
        </Card>
      </div>
    </ContentStudioLayout>
  );
}
