import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Dropdown, Menu, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useLocation, useMatches, useNavigate, useOutlet } from 'react-router-dom';
import { isElectronEgg } from '../ipc';
import sidebarLogo from '../assets/sidebar-logo.png';
import { AppRequestLoading } from '../components/AppRequestLoading';
import { routePaths } from '../routes/paths';
import { buildSidebarMenuItems, getWorkspaceLayoutState } from '../routes/routeConfig';
import type { User } from '../types';
import './ProtectedLayout.scss';

type ProtectedLayoutProps = {
  currentUser: User;
  onLogout: () => void;
};

type WorkspaceHeaderContextValue = {
  setHeaderExtra: (content: ReactNode) => void;
};

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null);

export function useWorkspaceHeader() {
  const context = useContext(WorkspaceHeaderContext);
  if (!context) {
    throw new Error('useWorkspaceHeader must be used within ProtectedLayout.');
  }
  return context;
}

export function ProtectedLayout({ currentUser, onLogout }: ProtectedLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const outlet = useOutlet();
  const routeState = useMemo(
    () => getWorkspaceLayoutState(currentUser, location.pathname, matches),
    [currentUser, location.pathname, matches],
  );
  const sidebarMenuItems = useMemo(
    () => buildSidebarMenuItems(currentUser),
    [currentUser],
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
    { key: 'account', icon: <UserOutlined />, label: '账号中心' },
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
          navigate(routePaths.login, { replace: true });
        },
      });
      return;
    }
    if (key === 'account') {
      navigate(routePaths.account);
      return;
    }
    navigate(routePaths.defaultModule);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={sidebarLogo} alt="萌猫" />
          <div>
            <strong>萌猫</strong>
            {/* <span>{isElectronEgg ? 'Electron 已连接' : 'Web 模式'}</span> */}
          </div>
        </div>

        <nav className="module-nav">
          <Menu
            items={sidebarMenuItems}
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
              <strong>{currentUser?.displayName || currentUser?.username}</strong>
              <span>账号中心</span>
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
