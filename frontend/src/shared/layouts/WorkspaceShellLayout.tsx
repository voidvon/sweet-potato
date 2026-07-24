import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Dropdown, Menu, message, Modal } from 'antd';
import type { MenuProps } from 'antd';
import {
  LogoutOutlined,
  PlusCircleOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useMatches, useNavigate, useOutlet, type UIMatch } from 'react-router-dom';
import { AppRequestLoading } from '../components/AppRequestLoading';
import { CreditIcon } from '../components/CreditIcon';
import { formatIntegerCreditAmount } from '../utils/credits';
import './WorkspaceShellLayout.scss';

const SHOW_TUTORIAL_ACTION = false;

export type WorkspaceRouteState = {
  activeOpenKeys: string[];
  currentMenuTitle: string;
  defaultOpenKeys: string[];
  hideWorkspaceHeader?: boolean;
  isChatPage: boolean;
  isContentStudioPage: boolean;
  isContentStudioVideoCreatePage: boolean;
  isImmersivePage: boolean;
  selectedMenuKey: string | null;
};

export type WorkspaceMenuItem = {
  children?: WorkspaceMenuItem[];
  icon?: unknown;
  key: string;
  label?: unknown;
  selectedIcon?: unknown;
};

export type WorkspaceBottomNavItem = {
  icon: ReactNode;
  key: string;
  label: string;
  selectedIcon?: ReactNode;
};

type ShellUser = {
  avatarUrl?: string;
  creditBalance?: number;
  displayName?: string;
  username: string;
};

type WorkspaceShellLayoutProps<User extends ShellUser> = {
  accountLabel?: string;
  accountPath: string;
  appName?: string;
  appSubtitle?: string;
  brandLogoSrc: string;
  currentUser: User;
  defaultPath: string;
  getWorkspaceLayoutState: (currentUser: User, pathname: string, matches: UIMatch[]) => WorkspaceRouteState;
  loginPath: string;
  onLogout: () => void;
  sidebarMenuItems: WorkspaceMenuItem[];
  mobileBottomNavItems?: WorkspaceBottomNavItem[];
  compactSidebar?: boolean;
  showGlobalActions?: boolean;
};

type WorkspaceHeaderContextValue = {
  setHeaderExtra: (content: ReactNode) => void;
};

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null);

function containsSelectedMenuItem(item: WorkspaceMenuItem, selectedKey: string | null): boolean {
  return item.key === selectedKey || Boolean(item.children?.some((child) => containsSelectedMenuItem(child, selectedKey)));
}

function resolveSelectedMenuIcons(items: WorkspaceMenuItem[], selectedKey: string | null): WorkspaceMenuItem[] {
  return items.map((item) => {
    const { selectedIcon, ...menuItem } = item;
    return {
      ...menuItem,
      children: item.children ? resolveSelectedMenuIcons(item.children, selectedKey) : undefined,
      icon: selectedIcon && containsSelectedMenuItem(item, selectedKey) ? selectedIcon : item.icon,
    };
  });
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose the Clipboard API but deny access.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('Copy failed');
  }
}

export function useWorkspaceHeader() {
  const context = useContext(WorkspaceHeaderContext);
  if (!context) {
    throw new Error('useWorkspaceHeader must be used within WorkspaceShellLayout.');
  }
  return context;
}

export function WorkspaceShellLayout<User extends ShellUser>({
  accountLabel = '账号中心',
  accountPath,
  appName = '萌猫',
  appSubtitle,
  brandLogoSrc,
  currentUser,
  defaultPath,
  getWorkspaceLayoutState,
  loginPath,
  onLogout,
  sidebarMenuItems,
  mobileBottomNavItems = [],
  compactSidebar = false,
  showGlobalActions = false,
}: WorkspaceShellLayoutProps<User>) {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const outlet = useOutlet();
  const defaultDocumentTitleRef = useRef(document.title);
  const routeState = useMemo(
    () => getWorkspaceLayoutState(currentUser, location.pathname, matches),
    [currentUser, getWorkspaceLayoutState, location.pathname, matches],
  );
  const [openKeys, setOpenKeys] = useState<string[]>(routeState.defaultOpenKeys);
  const [headerExtra, setHeaderExtra] = useState<ReactNode>(null);
  const syncedPathnameRef = useRef(location.pathname);
  const workspaceHeaderContextValue = useMemo(
    () => ({ setHeaderExtra }),
    [setHeaderExtra],
  );
  const resolvedSidebarMenuItems = useMemo(
    () => resolveSelectedMenuIcons(sidebarMenuItems, routeState.selectedMenuKey),
    [routeState.selectedMenuKey, sidebarMenuItems],
  );

  useEffect(() => {
    if (syncedPathnameRef.current === location.pathname) {
      return;
    }
    syncedPathnameRef.current = location.pathname;

    if (routeState.activeOpenKeys.length > 0 || routeState.defaultOpenKeys.length > 0) {
      setOpenKeys((current) => Array.from(new Set([
        ...current,
        ...routeState.defaultOpenKeys,
        ...routeState.activeOpenKeys,
      ])));
    }
  }, [location.pathname, routeState.activeOpenKeys, routeState.defaultOpenKeys]);

  useEffect(() => {
    setHeaderExtra(null);
  }, [location.pathname]);

  useEffect(() => {
    const defaultDocumentTitle = defaultDocumentTitleRef.current;
    document.title = `${routeState.currentMenuTitle} | ${defaultDocumentTitle}`;

    return () => {
      document.title = defaultDocumentTitle;
    };
  }, [routeState.currentMenuTitle]);

  const settingsItems: MenuProps['items'] = [
    { key: 'account', icon: <UserOutlined />, label: accountLabel },
    { key: 'logout', danger: true, icon: <LogoutOutlined />, label: '退出登录' },
  ];

  const handleSettingsClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === 'logout') {
      Modal.confirm({
        title: '确认退出登录？',
        content: '退出后需要重新输入账号和密码才能进入系统。',
        centered: true,
        okText: '退出登录',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          onLogout();
          navigate(loginPath, { replace: true });
        },
      });
      return;
    }
    if (key === 'account') {
      navigate(accountPath);
      return;
    }
    navigate(defaultPath);
  };

  const renderAccountAvatar = (className: string, size: number) => (
    <Avatar
      className={className}
      icon={<UserOutlined />}
      size={size}
      src={currentUser.avatarUrl}
    />
  );

  const handleInvite = async () => {
    try {
      await copyText(window.location.origin);
      message.success('邀请链接已复制，快分享给好友吧');
    } catch {
      message.error('复制失败，请手动复制当前网址');
    }
  };

  const renderGlobalActions = (floating = false) => (
    <div
      aria-label="全局操作"
      className={`workspace-global-actions${floating ? ' workspace-global-actions-floating' : ''}`}
    >
      {SHOW_TUTORIAL_ACTION ? (
        <button
          className="workspace-global-action workspace-global-action-secondary"
          onClick={() => message.info('教程内容正在完善，敬请期待')}
          type="button"
        >
          <QuestionCircleOutlined />
          <span>教程</span>
        </button>
      ) : null}
      <div className="workspace-credit-actions">
        <button
          className="workspace-credit-action workspace-credit-balance"
          onClick={() => navigate(`${accountPath}?tab=ledger`)}
          type="button"
        >
          <CreditIcon />
          <span className="workspace-credit-label">总积分</span>
          <strong>{formatIntegerCreditAmount(currentUser.creditBalance || 0)}</strong>
        </button>
        <button
          className="workspace-credit-action workspace-recharge-label"
          onClick={() => message.info('如需充值，请联系管理员')}
          type="button"
        >
          <PlusCircleOutlined />
          <span>充值</span>
        </button>
      </div>
      <button
        className="workspace-global-action workspace-global-action-secondary workspace-invite-action"
        onClick={() => void handleInvite()}
        type="button"
      >
        <UserAddOutlined />
        <span>邀请好友</span>
      </button>
      <Dropdown
        classNames={{ root: 'settings-dropdown-overlay' }}
        menu={{ items: settingsItems, onClick: handleSettingsClick }}
        placement="bottomRight"
        trigger={['click']}
      >
        <button aria-label="打开账户菜单" className="workspace-account-trigger" type="button">
          {renderAccountAvatar('workspace-account-avatar', 36)}
        </button>
      </Dropdown>
    </div>
  );

  const renderSidebarBody = () => (
    <>
      <nav className="module-nav">
        <Menu
          items={resolvedSidebarMenuItems as MenuProps['items']}
          mode={!compactSidebar ? 'inline' : 'vertical'}
          onClick={({ key }) => {
            if (key.startsWith('/')) {
              navigate(key);
            }
          }}
          rootClassName='module-nav-menu'
          onOpenChange={setOpenKeys}
          selectedKeys={routeState.selectedMenuKey ? [routeState.selectedMenuKey] : []}
          {...(!compactSidebar ? { openKeys } : {})}
        />
      </nav>

      <Dropdown
        classNames={{ root: 'settings-dropdown-overlay' }}
        menu={{ items: settingsItems, onClick: handleSettingsClick }}
        popupRender={(menu) => (
          <div className="settings-dropdown-panel">
            <div className="settings-dropdown-user">
              {renderAccountAvatar('settings-dropdown-avatar', 36)}
              <div className="settings-dropdown-user-copy">
                <strong title={currentUser.displayName || currentUser.username}>
                  {currentUser.displayName || currentUser.username}
                </strong>
                {currentUser.displayName ? (
                  <span title={currentUser.username}>{currentUser.username}</span>
                ) : null}
              </div>
            </div>
            <div className="settings-dropdown-divider" />
            {menu}
          </div>
        )}
        styles={{ root: { minWidth: 184 } }}
        placement="top"
        trigger={['click']}
      >
        <button className="settings-trigger" type="button">
          <span className="settings-avatar-hit">
            {renderAccountAvatar('settings-avatar', 34)}
          </span>
          <div>
            <strong>{currentUser.displayName || currentUser.username}</strong>
            <span>{accountLabel}</span>
          </div>
          <span className="settings-icon-hit">
            <span className="sidebar-settings-icon">
              <SettingOutlined />
            </span>
          </span>
          <span className="settings-mobile-label">设置与支持</span>
        </button>
      </Dropdown>
    </>
  );

  return (
    <main className={`app-shell${compactSidebar ? ' app-shell-compact-sidebar' : ''}`}>
      <aside aria-label="主导航" className="sidebar desktop-sidebar">
        <div className="brand">
          <img className="brand-logo" src={brandLogoSrc} alt={appName} />
          <div className="brand-copy">
            <strong>{appName}</strong>
            {appSubtitle ? <span>{appSubtitle}</span> : null}
          </div>
        </div>
        {renderSidebarBody()}
      </aside>

      {compactSidebar && mobileBottomNavItems.length > 0 ? (
        <nav aria-label="移动端底部导航" className="mobile-bottom-nav">
          {mobileBottomNavItems.map((item) => {
            const selected = location.pathname === item.key;
            return (
              <button
                className={`mobile-bottom-nav-item${selected ? ' is-selected' : ''}`}
                key={item.key}
                onClick={() => navigate(item.key)}
                type="button"
              >
                <span className="mobile-bottom-nav-icon">{selected && item.selectedIcon ? item.selectedIcon : item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      <section className={`workspace${routeState.isChatPage ? ' chat-workspace' : ''}${routeState.isContentStudioPage ? ' workspace-studio' : ''}${routeState.isContentStudioVideoCreatePage ? ' workspace-studio-video-create' : ''}`}>
        {!routeState.hideWorkspaceHeader ? (
          <header className={`workspace-header${showGlobalActions ? ' workspace-header-global' : ''}`}>
            <h1>{routeState.currentMenuTitle}</h1>
            {headerExtra ? (
              <div className="workspace-header-extra">
                {headerExtra}
              </div>
            ) : null}
            {showGlobalActions ? renderGlobalActions() : null}
          </header>
        ) : null}
        {routeState.hideWorkspaceHeader && showGlobalActions ? renderGlobalActions(true) : null}
        <div className={`workspace-content${routeState.isImmersivePage ? ' workspace-content-immersive' : ''}${routeState.isContentStudioPage ? ' workspace-content-studio' : ''}`}>
          <div className={`workspace-surface${routeState.isImmersivePage ? ' workspace-surface-immersive' : ''}${routeState.isContentStudioPage ? ' workspace-surface-studio' : ''}`}>
            <WorkspaceHeaderContext.Provider value={workspaceHeaderContextValue}>
              <div className={`route-transition-frame${routeState.isContentStudioPage ? ' route-transition-frame-studio' : ''}`} key={location.pathname}>
                {outlet}
              </div>
            </WorkspaceHeaderContext.Provider>
          </div>
          <AppRequestLoading />
        </div>
      </section>
    </main>
  );
}
