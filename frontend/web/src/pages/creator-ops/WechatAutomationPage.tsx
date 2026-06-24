import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlayCircleOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  isElectronEgg,
  runWechatProbe,
  sendWechatMessage,
  type WechatAutomationLog,
  type WechatProbeNode,
  type WechatProbeResult,
  type WechatSendMessageResult,
} from '../../ipc';
import './WechatAutomationPage.scss';

type ProbeState = {
  running: boolean;
  result: WechatProbeResult | null;
};

type SendState = {
  running: boolean;
  result: WechatSendMessageResult | null;
};

const DEFAULT_WINDOW_NAME = '微信';

const columns: ColumnsType<WechatProbeNode> = [
  {
    title: '控件类型',
    dataIndex: 'controlType',
    key: 'controlType',
    width: 180,
    render: (value: string) => <Tag>{value || '未知'}</Tag>,
  },
  {
    title: '名称',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
    render: (value: string) => value || '-',
  },
  {
    title: 'AutomationId',
    dataIndex: 'automationId',
    key: 'automationId',
    ellipsis: true,
    render: (value: string) => value || '-',
  },
  {
    title: 'ClassName',
    dataIndex: 'className',
    key: 'className',
    ellipsis: true,
    render: (value: string) => value || '-',
  },
];

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
  const [windowName, setWindowName] = useState(DEFAULT_WINDOW_NAME);
  const [contactName, setContactName] = useState('');
  const [messageText, setMessageText] = useState('');
  const [probeState, setProbeState] = useState<ProbeState>({
    running: false,
    result: null,
  });
  const [sendState, setSendState] = useState<SendState>({
    running: false,
    result: null,
  });

  const rows = useMemo(
    () => (probeState.result?.data?.children || []).map((item, index) => ({ ...item, key: `${item.controlType}-${index}` })),
    [probeState.result],
  );

  async function handleProbe() {
    setProbeState((current) => ({ ...current, running: true }));
    const result = await runWechatProbe(windowName.trim() || DEFAULT_WINDOW_NAME);
    setProbeState({
      running: false,
      result,
    });
    if (!result.ok) {
      message.error(result.message || '微信探测失败');
      return;
    }
    message.success('微信窗口探测完成');
  }

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
      windowName: windowName.trim() || DEFAULT_WINDOW_NAME,
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
        <section className="wechat-automation-hero">
          <div>
            <Typography.Title level={3}>微信测试台</Typography.Title>
            <Typography.Paragraph>
              这个入口专门承接微信自动化测试。当前已经接通 Windows + Electron + Python `uiautomation`
              的窗口探测和最小消息发送闭环，后续联系人读取、聊天列表解析都继续在这里扩展。
            </Typography.Paragraph>
          </div>
          <Tag color={isElectronEgg ? 'green' : 'default'}>
            {isElectronEgg ? 'Electron 环境' : 'Web 环境'}
          </Tag>
        </section>

        {!isElectronEgg ? (
          <Alert
            showIcon
            type="warning"
            message="当前不是 Electron 环境"
            description="微信自动化依赖本地 Electron IPC，浏览器模式下不会执行任何探测或发送。"
          />
        ) : null}

        <Card className="wechat-automation-card" title="运行要求">
          <Alert
            showIcon
            type="info"
            message="环境说明"
            description="仅支持 Windows。请确保本机 Python 可执行，并且已安装 uiautomation；微信桌面版窗口标题默认使用“微信”。发送消息当前采用 Ctrl+F 搜索联系人，再定位输入框并按 Enter 发送。"
          />
        </Card>

        <Card className="wechat-automation-card" title="窗口探测">
          <Space className="wechat-automation-toolbar" direction="vertical" size={16}>
            <div className="wechat-automation-actions">
              <Input
                className="wechat-automation-window-input"
                onChange={(event) => setWindowName(event.target.value)}
                placeholder="输入微信窗口标题"
                value={windowName}
              />
              <Button
                icon={<PlayCircleOutlined />}
                loading={probeState.running}
                onClick={() => void handleProbe()}
                type="primary"
              >
                探测微信窗口
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => setProbeState({ running: false, result: null })}
              >
                清空结果
              </Button>
            </div>
          </Space>
        </Card>

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

        <Card className="wechat-automation-card" title="探测结果">
          {probeState.result?.ok && probeState.result.data ? (
            <Space className="wechat-automation-result" direction="vertical" size={16}>
              <div className="wechat-automation-summary">
                <Tag color="green">窗口: {probeState.result.data.windowName}</Tag>
                <Tag color="blue">一级子控件: {probeState.result.data.childCount}</Tag>
              </div>

              <Table
                columns={columns}
                dataSource={rows}
                pagination={false}
                rowKey="key"
                scroll={{ x: 860 }}
              />

              {probeState.result.command?.length ? (
                <Typography.Paragraph className="wechat-automation-command" type="secondary">
                  执行命令: {probeState.result.command.join(' ')}
                </Typography.Paragraph>
              ) : null}
            </Space>
          ) : probeState.result && !probeState.result.ok ? (
            <Alert
              showIcon
              type="error"
              message="探测失败"
              description={probeState.result.message || '未返回可用错误信息'}
            />
          ) : (
            <Empty description="还没有运行微信探测" />
          )}
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
