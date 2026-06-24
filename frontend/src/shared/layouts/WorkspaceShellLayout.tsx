import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Dropdown, Menu, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useMatches, useNavigate, useOutlet, type UIMatch } from 'react-router-dom';
import { AppRequestLoading } from '../components/AppRequestLoading';
import './WorkspaceShellLayout.scss';

export type WorkspaceRouteState = {
  activeOpenKeys: string[];
  currentMenuTitle: string;
  defaultOpenKeys: string[];
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
};

type ShellUser = {
  avatarUrl?: string;
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
};

type WorkspaceHeaderContextValue = {
  setHeaderExtra: (content: ReactNode) => void;
};

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null);

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
}: WorkspaceShellLayoutProps<User>) {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const outlet = useOutlet();
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={brandLogoSrc} alt={appName} />
          <div>
            <strong>{appName}</strong>
            {appSubtitle ? <span>{appSubtitle}</span> : null}
          </div>
        </div>

        <nav className="module-nav">
          <Menu
            items={sidebarMenuItems as MenuProps['items']}
            mode="inline"
            onClick={({ key }) => {
              if (key.startsWith('/')) {
                navigate(key);
              }
            }}
            onOpenChange={setOpenKeys}
            openKeys={openKeys}
            selectedKeys={routeState.selectedMenuKey ? [routeState.selectedMenuKey] : []}
          />
        </nav>

        <Dropdown
          classNames={{ root: 'settings-dropdown-overlay' }}
          menu={{ items: settingsItems, onClick: handleSettingsClick }}
          styles={{ root: { minWidth: 184 } }}
          placement="top"
          trigger={['click']}
        >
          <button className="settings-trigger" type="button">
            <Avatar
              className="settings-avatar"
              icon={<UserOutlined />}
              size={34}
              src={currentUser.avatarUrl}
            />
            <div>
              <strong>{currentUser.displayName || currentUser.username}</strong>
              <span>{accountLabel}</span>
            </div>
            <span className="settings-icon">
              <SettingOutlined />
            </span>
          </button>
        </Dropdown>
      </aside>

      <section className={`workspace${routeState.isChatPage ? ' chat-workspace' : ''}${routeState.isContentStudioPage ? ' workspace-studio' : ''}${routeState.isContentStudioVideoCreatePage ? ' workspace-studio-video-create' : ''}`}>
        <header className="workspace-header">
          <h1>{routeState.currentMenuTitle}</h1>
          {headerExtra ? (
            <div className="workspace-header-extra">
              {headerExtra}
            </div>
          ) : null}
        </header>
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
