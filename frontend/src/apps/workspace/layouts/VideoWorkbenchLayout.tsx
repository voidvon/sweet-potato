import type { ReactNode } from 'react';
import './VideoWorkbenchLayout.scss';

type VideoWorkbenchLayoutProps = {
  sidebarHeader?: ReactNode;
  sidebarTitle?: ReactNode;
  sidebarContent: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  startContent?: ReactNode;
  showStartContent?: boolean;
};

export function VideoWorkbenchLayout({
  sidebarHeader,
  sidebarTitle,
  sidebarContent,
  children,
  footer,
  startContent,
  showStartContent = false,
}: VideoWorkbenchLayoutProps) {
  return (
    <div className="video-workbench-layout">
      <aside className="video-workbench-sidebar">
        {sidebarHeader ? (
          <div className="video-workbench-sidebar-header">{sidebarHeader}</div>
        ) : null}
        {sidebarTitle ? (
          <div className="video-workbench-sidebar-title">{sidebarTitle}</div>
        ) : null}
        <div className="video-workbench-sidebar-body">{sidebarContent}</div>
      </aside>

      <section className="video-workbench-main">
        <div className={`video-workbench-main-body${showStartContent ? ' is-start' : ''}`}>
          {showStartContent ? startContent : children}
        </div>
        {footer ? <div className="video-workbench-footer">{footer}</div> : null}
      </section>
    </div>
  );
}
