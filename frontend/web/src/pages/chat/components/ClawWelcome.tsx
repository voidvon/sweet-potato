import {
  BulbOutlined,
  CommentOutlined,
  CustomerServiceOutlined,
  FileTextOutlined,
  PlaySquareOutlined,
  RocketOutlined,
  RobotOutlined,
  SearchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import type { ReactNode } from 'react';
import type { ClawSkill } from '../types';
import './ClawWelcome.scss';

type ClawWelcomeProps = {
  onSkillClick: (skill: ClawSkill) => void;
  skills: ClawSkill[];
};

function getSkillIcon(skill: ClawSkill) {
  if (skill.source === 'uploaded') {
    return <BulbOutlined />;
  }
  if (skill.name.includes('微信') || skill.name.includes('企微')) {
    return <CommentOutlined />;
  }
  if (skill.name.includes('客服')) {
    return <CustomerServiceOutlined />;
  }
  if (skill.name.includes('视频')) {
    return skill.name.includes('生成') ? <VideoCameraOutlined /> : <PlaySquareOutlined />;
  }
  if (skill.name.includes('搜索') || skill.name.includes('geo')) {
    return <SearchOutlined />;
  }
  if (skill.name.includes('文案') || skill.name.includes('Word')) {
    return <FileTextOutlined />;
  }
  if (skill.name.includes('工作流')) {
    return <RocketOutlined />;
  }
  return <BulbOutlined />;
}

export function ClawWelcome({ onSkillClick, skills }: ClawWelcomeProps) {
  return (
    <div className="claw-welcome">
      <div className="claw-avatar-bot">
        <RobotOutlined />
      </div>
      <h1>数字员工</h1>
      <p>你好！我是你的数字员工，请输入你的需求开始对话。</p>

      <div className="claw-quick-actions">
        {skills.map((skill) => (
          <Button key={skill.id} onClick={() => onSkillClick(skill)}>
            {getSkillIcon(skill)}
            {skill.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
