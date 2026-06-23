import type { ReactNode } from 'react';
import './ContentStudioLayout.scss';

type ContentStudioLayoutProps = {
  children: ReactNode;
};

export function ContentStudioLayout({ children }: ContentStudioLayoutProps) {
  return (
    <div className="content-studio-layout">
      {children}
    </div>
  );
}
