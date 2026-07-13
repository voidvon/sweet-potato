import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  CaptionsOff,
  Check,
  ChevronDown,
  Clapperboard,
  Languages,
  Megaphone,
  Mic2,
  PersonStanding,
  Replace,
  ScanLine,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toolOptions } from '../constants';
import type { ToolOption } from '../types';

type ToolSwitcherProps = {
  currentTool: ToolOption;
  isOpen: boolean;
  onSelect: (tool: ToolOption) => void;
  onOpenChange: (open: boolean) => void;
};

const toolIcons: Record<string, LucideIcon> = {
  视频: Video,
  视频高清放大: ScanLine,
  口播视频生成: Mic2,
  '模特 / 商品替换': Replace,
  跳舞复刻: PersonStanding,
  营销视频生成: Megaphone,
  字幕擦除: CaptionsOff,
  视频翻译: Languages,
};

export function ToolSwitcher({ currentTool, isOpen, onSelect, onOpenChange }: ToolSwitcherProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const [dropdownWidth, setDropdownWidth] = useState<number>();
  const CurrentToolIcon = toolIcons[currentTool.label] ?? Clapperboard;

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return undefined;
    }

    const syncDropdownWidth = () => {
      setDropdownWidth(trigger.getBoundingClientRect().width);
    };

    syncDropdownWidth();

    const resizeObserver = new ResizeObserver(syncDropdownWidth);
    resizeObserver.observe(trigger);
    window.addEventListener('resize', syncDropdownWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncDropdownWidth);
    };
  }, []);

  const menuItems: MenuProps['items'] = toolOptions.map((option) => {
    const isActive = option.label === currentTool.label;
    const ToolIcon = toolIcons[option.label] ?? Clapperboard;

    return {
      key: option.label,
      icon: (
        <span className="video-task-tool-option-icon">
          <ToolIcon size={20} />
        </span>
      ),
      label: (
        <span className="video-task-tool-option-content">
          <span className="video-task-tool-option-copy">
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
          {isActive ? <Check className="video-task-tool-option-check" size={16} /> : null}
        </span>
      ),
    };
  });

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    const selectedTool = toolOptions.find((option) => option.label === key);
    if (selectedTool) {
      onSelect(selectedTool);
    }
  };

  return (
    <Dropdown
      classNames={{ root: 'video-task-tool-dropdown' }}
      menu={{
        items: menuItems,
        onClick: handleMenuClick,
        selectedKeys: [currentTool.label],
      }}
      onOpenChange={onOpenChange}
      open={isOpen}
      placement="bottomLeft"
      styles={dropdownWidth ? { root: { width: dropdownWidth } } : undefined}
      trigger={['click']}
    >
      <div className="video-task-current-card" ref={triggerRef}>
        <div className="video-task-feature-icon">
          <CurrentToolIcon size={24} />
        </div>
        <div className="video-task-current-copy">
          <span>当前视频功能</span>
          <strong>{currentTool.label}</strong>
          <p>{currentTool.description}</p>
        </div>
        <Button className="video-task-switch" shape="round" size="small" type="primary">
          切换
          <ChevronDown className={`video-task-switch-icon${isOpen ? ' is-open' : ''}`} size={16} />
        </Button>
      </div>
    </Dropdown>
  );
}
