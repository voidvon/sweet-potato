import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Drawer, Dropdown, Menu, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { CloseOutlined, LogoutOutlined, MenuOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
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
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
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
    setIsMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!compactSidebar) {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);

    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, [compactSidebar]);

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

  const renderSidebarBody = (mobile: boolean) => (
    <>
      <nav className="module-nav">
        <Menu
          items={resolvedSidebarMenuItems as MenuProps['items']}
          mode={mobile || !compactSidebar ? 'inline' : 'vertical'}
          onClick={({ key }) => {
            if (key.startsWith('/')) {
              navigate(key);
              if (mobile) {
                setIsMobileSidebarOpen(false);
              }
            }
          }}
          onOpenChange={setOpenKeys}
          selectedKeys={routeState.selectedMenuKey ? [routeState.selectedMenuKey] : []}
          {...(mobile || !compactSidebar ? { openKeys } : {})}
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
          <span className="settings-mobile-label">设置与支持</span>
        </button>
      </Dropdown>
    </>
  );

  return (
    <main className={`app-shell${compactSidebar ? ' app-shell-compact-sidebar' : ''}`}>
      {compactSidebar ? (
        <button
          aria-label="打开导航菜单"
          className="mobile-sidebar-trigger"
          onClick={() => setIsMobileSidebarOpen(true)}
          type="button"
        >
          <MenuOutlined />
        </button>
      ) : null}

      <aside aria-label="主导航" className="sidebar desktop-sidebar">
        <div className="brand">
          <img className="brand-logo" src={brandLogoSrc} alt={appName} />
          <div className="brand-copy">
            <strong>{appName}</strong>
            {appSubtitle ? <span>{appSubtitle}</span> : null}
          </div>
        </div>
        {renderSidebarBody(false)}
      </aside>

      {compactSidebar && isMobileViewport ? (
        <Drawer
          closeIcon={<CloseOutlined />}
          closable={{ placement: 'end' }}
          destroyOnHidden
          onClose={() => setIsMobileSidebarOpen(false)}
          open={isMobileSidebarOpen}
          placement="left"
          rootClassName="workspace-mobile-drawer"
          title={(
            <div className="mobile-drawer-brand">
              <img className="brand-logo" src={brandLogoSrc} alt={appName} />
              <div className="brand-copy">
                <strong>{appName}</strong>
                {appSubtitle ? <span>{appSubtitle}</span> : null}
              </div>
            </div>
          )}
          width={392}
        >
          <aside aria-label="主导航" className="mobile-sidebar-content">
            {renderSidebarBody(true)}
          </aside>
        </Drawer>
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
