import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import './WorkspaceSection.scss';

type WorkspaceSectionProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  description?: ReactNode;
  headerExtra?: ReactNode;
  headerLayout?: 'inline' | 'stacked';
  title: ReactNode;
  variant?: 'card' | 'plain';
};

export const WorkspaceSection = forwardRef<HTMLElement, WorkspaceSectionProps>(function WorkspaceSection({
  children,
  className,
  description,
  headerExtra,
  headerLayout = 'inline',
  title,
  variant = 'card',
  ...sectionProps
}, ref) {
  const sectionClassName = [
    'video-task-workspace-section',
    `is-${variant}`,
    variant === 'card' ? 'video-task-card' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <section className={sectionClassName} ref={ref} {...sectionProps}>
      <header className={`video-task-workspace-section-header is-${headerLayout}`}>
        <div className="video-task-workspace-section-copy">
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {headerExtra ? <div className="video-task-workspace-section-extra">{headerExtra}</div> : null}
      </header>
      {children}
    </section>
  );
});
