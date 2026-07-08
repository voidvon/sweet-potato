import { Check, ChevronDown, Clapperboard } from 'lucide-react';
import { toolOptions } from '../constants';
import type { ToolOption } from '../types';

type ToolSwitcherProps = {
  currentTool: ToolOption;
  isOpen: boolean;
  onSelect: (tool: ToolOption) => void;
  onToggle: () => void;
};

export function ToolSwitcher({ currentTool, isOpen, onSelect, onToggle }: ToolSwitcherProps) {
  return (
    <>
      <div className="video-task-current-card">
        <div className="video-task-feature-icon">
          <Clapperboard size={24} />
        </div>
        <div className="video-task-current-copy">
          <span>当前视频功能</span>
          <strong>{currentTool.label}</strong>
          <p>{currentTool.description}</p>
        </div>
        {/* <button className="video-task-switch" onClick={onToggle} type="button">
          切换
          <ChevronDown size={16} />
        </button> */}
      </div>

      {isOpen && (
        <div className="video-task-tool-menu">
          {toolOptions.map((option) => (
            <button
              className={`video-task-tool-option${option.label === currentTool.label ? ' is-active' : ''}`}
              key={option.label}
              onClick={() => onSelect(option)}
              type="button"
            >
              <span className="video-task-tool-option-icon"><Clapperboard size={20} /></span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.label === currentTool.label && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
