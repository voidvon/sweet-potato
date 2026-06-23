import type { CSSProperties, ReactNode } from 'react';
import './FloatingComposer.scss';

type FloatingComposerProps = {
  after?: ReactNode;
  before?: ReactNode;
  className?: string;
  input: ReactNode;
  maxWidth?: string;
  topContent?: ReactNode;
  wrapClassName?: string;
};

export function FloatingComposer({
  after,
  before,
  className,
  input,
  maxWidth = '660px',
  topContent,
  wrapClassName,
}: FloatingComposerProps) {
  const wrapClasses = ['floating-composer-wrap', wrapClassName].filter(Boolean).join(' ');
  const composerClasses = ['floating-composer', className].filter(Boolean).join(' ');
  const gridTemplateColumns = before && after
    ? 'auto minmax(0, 1fr) auto'
    : before
      ? 'auto minmax(0, 1fr)'
      : after
        ? 'minmax(0, 1fr) auto'
        : 'minmax(0, 1fr)';

  return (
    <section
      className={wrapClasses}
      style={{ '--floating-composer-width': maxWidth } as CSSProperties}
    >
      <div className="floating-composer-shell">
        {topContent ? <div className="floating-composer-top">{topContent}</div> : null}
        <div
          className={composerClasses}
          style={{ gridTemplateColumns }}
        >
          {before ? <div className="floating-composer-before">{before}</div> : null}
          <div className="floating-composer-input">{input}</div>
          {after ? <div className="floating-composer-after">{after}</div> : null}
        </div>
      </div>
    </section>
  );
}
