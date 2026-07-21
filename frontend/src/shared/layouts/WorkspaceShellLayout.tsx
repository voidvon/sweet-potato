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
          onOpenChange={setOpenKeys}
          selectedKeys={routeState.selectedMenuKey ? [routeState.selectedMenuKey] : []}
          {...(!compactSidebar ? { openKeys } : {})}
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
          <span className="settings-avatar-hit">
            <Avatar
              className="settings-avatar"
              icon={<UserOutlined />}
              size={34}
              src={currentUser.avatarUrl}
            />
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
          <header className="workspace-header">
            <h1>{routeState.currentMenuTitle}</h1>
            {headerExtra ? (
              <div className="workspace-header-extra">
                {headerExtra}
              </div>
            ) : null}
          </header>
        ) : null}
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
