import { Segmented } from 'antd';
import type { ReactNode } from 'react';
import './ViralWorkbenchStartPanel.scss';

type StartModeOption<TMode extends string> = {
  key: TMode;
  label: string;
  icon: ReactNode;
};

type ViralWorkbenchStartPanelProps<TMode extends string> = {
  title: string;
  description: string;
  heroIcon: ReactNode;
  featureItems: ReactNode[];
  activeMode: TMode;
  modeOptions: Array<StartModeOption<TMode>>;
  onModeChange: (mode: TMode) => void;
  showModeTabs?: boolean;
  children: ReactNode;
};

export function ViralWorkbenchStartPanel<TMode extends string>({
  title,
  description,
  heroIcon,
  featureItems,
  activeMode,
  modeOptions,
  onModeChange,
  showModeTabs = true,
  children,
}: ViralWorkbenchStartPanelProps<TMode>) {
  return (
    <div className="viral-workbench-start">
      <div className="viral-workbench-hero">
        <p>{description}</p>
        <div className="viral-workbench-feature-row">
          {featureItems.map((item, index) => (
            <span key={index}>{item}</span>
          ))}
        </div>
      </div>

      <div className="viral-workbench-card">
        {showModeTabs ? (
          <Segmented
            block
            className="viral-workbench-mode-tabs"
            onChange={(value) => onModeChange(value as TMode)}
            options={modeOptions.map((option) => ({
              label: (
                <span className="viral-workbench-mode-option">
                  {option.icon}
                  {option.label}
                </span>
              ),
              value: option.key,
            }))}
            value={activeMode}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}
