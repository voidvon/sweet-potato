import { useState } from 'react';
import { Alert, Button, Empty, Input, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  closeWechatAddFriendWindows,
  clickWechatAddFriendEntry,
  handleWechatAddFriendResult,
  identifyWechatCurrentPanel,
  isElectronEgg,
  searchWechatAddFriendAccount,
  searchOpenWechatFriend,
  sendWechatCurrentChatMessage,
  switchWechatPanel,
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
          <span>
            {log.message}
            {log.details ? (
              <pre className="wechat-automation-log-details">{JSON.stringify(log.details, null, 2)}</pre>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export function WechatAutomationPage() {
  const [account, setAccount] = useState('');
  const [greeting, setGreeting] = useState('');
  const [panelIdentifyRunning, setPanelIdentifyRunning] = useState(false);
  const [switchPanelRunning, setSwitchPanelRunning] = useState<'微信' | '通讯录' | null>(null);
  const [addFriendEntryRunning, setAddFriendEntryRunning] = useState(false);
  const [toolRunning, setToolRunning] = useState<string | null>(null);
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

  const isToolBusy = panelIdentifyRunning
    || Boolean(switchPanelRunning)
    || addFriendEntryRunning
    || Boolean(toolRunning)
    || submitRunning;

  async function runToolAction(actionLabel: string, action: () => Promise<WechatAutomationActionResult>) {
    setToolRunning(actionLabel);
    const result = await action();
    setToolRunning(null);
    updateExecutionResult(actionLabel, result);

    if (!result.ok) {
      message.error(result.message || `${actionLabel}失败`);
      return;
    }
    message.success(result.message || `${actionLabel}已执行`);
  }

  async function handleIdentifyCurrentPanel() {
    setPanelIdentifyRunning(true);
    const result = await identifyWechatCurrentPanel({
      windowName: DEFAULT_WINDOW_NAME,
    });
    setPanelIdentifyRunning(false);
    updateExecutionResult('识别当前面板', result);

    if (!result.ok) {
      message.error(result.message || '识别当前面板失败');
      return;
    }
    message.success(result.message || '已识别当前面板');
  }

  async function handleSwitchPanel(panel: '微信' | '通讯录') {
    setSwitchPanelRunning(panel);
    const result = await switchWechatPanel({
      windowName: DEFAULT_WINDOW_NAME,
      panel,
    });
    setSwitchPanelRunning(null);
    updateExecutionResult(`切换到${panel}面板`, result);

    if (!result.ok) {
      message.error(result.message || `切换到${panel}面板失败`);
      return;
    }
    message.success(result.message || `已切换到${panel}面板`);
  }

  async function handleClickAddFriendEntry() {
    setAddFriendEntryRunning(true);
    const result = await clickWechatAddFriendEntry({
      windowName: DEFAULT_WINDOW_NAME,
    });
    setAddFriendEntryRunning(false);
    updateExecutionResult('点击快捷操作并点击添加朋友', result);

    if (!result.ok) {
      message.error(result.message || '点击快捷操作并点击添加朋友失败');
      return;
    }
    message.success(result.message || '已点击添加朋友入口');
  }

  async function handleSearchAddFriendAccount() {
    if (!account.trim()) {
      message.error('请输入微信号或手机号');
      return;
    }

    await runToolAction('搜索账号', () => searchWechatAddFriendAccount({
      account: account.trim(),
    }));
  }

  async function handleSearchOpenFriend() {
    if (!account.trim()) {
      message.error('请输入好友关键词');
      return;
    }

    await runToolAction('搜索朋友并打开', () => searchOpenWechatFriend({
      windowName: DEFAULT_WINDOW_NAME,
      contactName: account.trim(),
    }));
  }

  async function handleAddFriendResult() {
    if (!greeting.trim()) {
      message.error('请输入打招呼内容');
      return;
    }

    await runToolAction('处理添加朋友搜索结果', () => handleWechatAddFriendResult({
      windowName: DEFAULT_WINDOW_NAME,
      greeting,
    }));
  }

  async function handleCloseAddFriendWindows() {
    await runToolAction('关闭添加朋友窗口', () => closeWechatAddFriendWindows({
      windowName: DEFAULT_WINDOW_NAME,
    }));
  }

  async function handleSendCurrentChatMessage() {
    if (!greeting.trim()) {
      message.error('请输入打招呼内容');
      return;
    }

    await runToolAction('发送消息', () => sendWechatCurrentChatMessage({
      windowName: DEFAULT_WINDOW_NAME,
      message: greeting,
    }));
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
    const steps: Array<{
      label: string;
      run: () => Promise<WechatAutomationActionResult>;
    }> = [
      {
        label: '点击快捷操作并点击添加朋友',
        run: () => clickWechatAddFriendEntry({ windowName: DEFAULT_WINDOW_NAME }),
      },
      {
        label: '搜索账号',
        run: () => searchWechatAddFriendAccount({ account: account.trim() }),
      },
      {
        label: '处理添加朋友搜索结果',
        run: () => handleWechatAddFriendResult({ windowName: DEFAULT_WINDOW_NAME, greeting }),
      },
    ];
    const mergedLogs: WechatAutomationLog[] = [];
    let result: WechatAutomationActionResult = {
      ok: true,
      message: '微信添加流程已执行',
      logs: mergedLogs,
      data: {
        steps: [],
      },
    };

    for (const step of steps) {
      mergedLogs.push({
        level: 'info',
        code: 'frontend_flow_step_started',
        message: `开始执行: ${step.label}`,
      });
      const stepResult = await step.run();
      mergedLogs.push(...(stepResult.logs || []));

      const stepSummary = {
        label: step.label,
        ok: stepResult.ok,
        message: stepResult.message,
        data: stepResult.data,
      };
      (result.data as { steps: typeof stepSummary[] }).steps.push(stepSummary);

      if (!stepResult.ok) {
        result = {
          ...stepResult,
          ok: false,
          message: `${step.label}失败: ${stepResult.message || '未返回错误信息'}`,
          logs: mergedLogs,
          data: result.data,
          command: stepResult.command,
        };
        break;
      }

      mergedLogs.push({
        level: 'info',
        code: 'frontend_flow_step_completed',
        message: `完成执行: ${step.label}`,
      });
    }

    if (result.ok) {
      result = {
        ...result,
        logs: mergedLogs,
      };
    }
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

        <section className="wechat-automation-toolkit" aria-label="微信操作工具集">
          <Typography.Title className="wechat-automation-toolkit-title" level={4}>
            微信操作工具集
          </Typography.Title>
          <Typography.Paragraph className="wechat-automation-toolkit-description" type="secondary">
            按步骤验证微信 UIA 操作链路。每个工具独立执行，结果输出到下方日志和 JSON。
          </Typography.Paragraph>

          <div className="wechat-automation-toolkit-actions">
            <Button
              disabled={isToolBusy && !panelIdentifyRunning}
              loading={panelIdentifyRunning}
              onClick={() => void handleIdentifyCurrentPanel()}
            >
              识别当前面板
            </Button>
            <Button
              disabled={isToolBusy && switchPanelRunning !== '微信'}
              loading={switchPanelRunning === '微信'}
              onClick={() => void handleSwitchPanel('微信')}
            >
              切换到微信
            </Button>
            <Button
              disabled={isToolBusy && switchPanelRunning !== '通讯录'}
              loading={switchPanelRunning === '通讯录'}
              onClick={() => void handleSwitchPanel('通讯录')}
            >
              切换到通讯录
            </Button>
            <Button
              disabled={isToolBusy && !addFriendEntryRunning}
              loading={addFriendEntryRunning}
              onClick={() => void handleClickAddFriendEntry()}
            >
              点击快捷操作并点击添加朋友
            </Button>
            <Button
              disabled={(isToolBusy && toolRunning !== '搜索账号') || !account.trim()}
              loading={toolRunning === '搜索账号'}
              onClick={() => void handleSearchAddFriendAccount()}
            >
              搜索账号
            </Button>
            <Button
              disabled={(isToolBusy && toolRunning !== '搜索朋友并打开') || !account.trim()}
              loading={toolRunning === '搜索朋友并打开'}
              onClick={() => void handleSearchOpenFriend()}
            >
              搜索朋友并打开
            </Button>
            <Button
              disabled={isToolBusy && toolRunning !== '处理添加朋友搜索结果'}
              loading={toolRunning === '处理添加朋友搜索结果'}
              onClick={() => void handleAddFriendResult()}
            >
              处理搜索结果
            </Button>
            <Button
              disabled={isToolBusy && toolRunning !== '关闭添加朋友窗口'}
              loading={toolRunning === '关闭添加朋友窗口'}
              onClick={() => void handleCloseAddFriendWindows()}
            >
              关闭添加朋友窗口
            </Button>
            <Button
              disabled={isToolBusy && toolRunning !== '发送消息'}
              loading={toolRunning === '发送消息'}
              onClick={() => void handleSendCurrentChatMessage()}
            >
              发送消息
            </Button>
          </div>
        </section>

        <section className="wechat-automation-section" aria-label="微信添加">
          <Typography.Title className="wechat-automation-section-title" level={4}>
            微信添加
          </Typography.Title>
          <Typography.Paragraph className="wechat-automation-section-description" type="secondary">
            自动执行完整链路：点击“快捷操作” - 点击“添加朋友” - 搜索微信号或手机号 - 输入打招呼内容 - 完成发送。
          </Typography.Paragraph>

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
              disabled={isToolBusy && !submitRunning}
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
        </section>

        <section className="wechat-automation-section" aria-label="执行日志">
          <Typography.Title className="wechat-automation-section-title" level={4}>
            {executionState.actionLabel ? `${executionState.actionLabel}日志` : '执行日志'}
          </Typography.Title>

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
        </section>
      </div>
    </ContentStudioLayout>
  );
}
