import { DeleteOutlined, EditOutlined, SearchOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Empty, Form, Input, Modal, Popconfirm, Typography, message } from 'antd';
import { useRef, useState } from 'react';
import type { ClawSkill } from '../types';
import './SkillCenterModal.scss';

type SkillCenterModalProps = {
  onClose: () => void;
  onRemoveSkill: (skillId: string) => Promise<void>;
  onUpdateSkill: (skillId: string, payload: { command: string; name: string }) => Promise<void>;
  onUploadFile: (file: File) => Promise<void>;
  open: boolean;
  skills: ClawSkill[];
};

function getSkillDescription(skill: ClawSkill) {
  return skill.description || '上传技能文件后会自动读取描述信息';
}

export function SkillCenterModal({
  onClose,
  onRemoveSkill,
  onUpdateSkill,
  onUploadFile,
  open,
  skills,
}: SkillCenterModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingSkill, setEditingSkill] = useState<ClawSkill>();
  const [keyword, setKeyword] = useState('');
  const [form] = Form.useForm<{ command: string; name: string }>();
  const [updating, setUpdating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const uploadedSkills = skills.filter((skill) => skill.source === 'uploaded');
  const filteredSkills = normalizedKeyword
    ? uploadedSkills.filter((skill) => `${skill.name} ${skill.description || ''} ${skill.command}`.toLowerCase().includes(normalizedKeyword))
    : uploadedSkills;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      setUploading(true);
      await onUploadFile(file);
      message.success('技能已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '技能上传失败');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  function startEdit(skill: ClawSkill) {
    setEditingSkill(skill);
    form.setFieldsValue({ command: skill.command, name: skill.name });
  }

  async function submitEdit() {
    if (!editingSkill) {
      return;
    }
    try {
      const values = await form.validateFields();
      setUpdating(true);
      await onUpdateSkill(editingSkill.id, {
        command: values.command.trim().replace(/^\//, ''),
        name: values.name.trim(),
      });
      setEditingSkill(undefined);
      message.success('技能已更新');
    } catch (error) {
      if (error instanceof Error) {
        message.error(error.message);
      }
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Modal
      centered
      className="skill-center-modal"
      footer={null}
      onCancel={onClose}
      open={open}
      title="技能中心"
      width={860}
    >
      <section className="skill-center-panel">
        <div className="skill-center-toolbar">
          <Input
            allowClear
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索技能..."
            prefix={<SearchOutlined />}
            value={keyword}
          />
          <input
            accept=".json,.md,.txt"
            hidden
            onChange={(event) => void handleFileChange(event)}
            ref={fileInputRef}
            type="file"
          />
          <Button icon={<UploadOutlined />} loading={uploading} onClick={() => fileInputRef.current?.click()} type="primary">
            上传
          </Button>
        </div>

        {filteredSkills.length === 0 ? (
          <Empty description="暂无匹配技能" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="skill-center-grid">
            {filteredSkills.map((skill) => (
              <article className="skill-center-card" key={skill.id}>
                <div className="skill-center-card-title">
                  <span className="skill-center-icon"><ThunderboltOutlined /></span>
                  <div>
                    <h3>{skill.name}</h3>
                    <span>/{skill.command}</span>
                  </div>
                </div>
                <Typography.Paragraph ellipsis={{ rows: 3, tooltip: getSkillDescription(skill) }}>
                  {getSkillDescription(skill)}
                </Typography.Paragraph>
                <div className="skill-center-actions">
                  <Button
                    aria-label={`修改 ${skill.name}`}
                    icon={<EditOutlined />}
                    onClick={() => startEdit(skill)}
                    size="small"
                    type="text"
                  />
                  <Popconfirm
                    cancelText="取消"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void onRemoveSkill(skill.id)}
                    placement="leftTop"
                    title={`确认删除「${skill.name}」？`}
                  >
                    <Button
                      aria-label={`删除 ${skill.name}`}
                      className="skill-center-delete"
                      danger
                      icon={<DeleteOutlined />}
                      size="small"
                      type="text"
                    />
                  </Popconfirm>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        cancelText="取消"
        confirmLoading={updating}
        okText="保存"
        onCancel={() => setEditingSkill(undefined)}
        onOk={() => void submitEdit()}
        open={Boolean(editingSkill)}
        title="编辑技能"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="技能名称"
            name="name"
            rules={[{ required: true, message: '请输入技能名称' }]}
          >
            <Input maxLength={80} placeholder="例如：画布设计" />
          </Form.Item>
          <Form.Item
            extra="输入时可以带 /，保存后会自动规范为小写英文连接符。"
            label="技能调用名"
            name="command"
            rules={[
              { required: true, message: '请输入技能调用名' },
              { pattern: /^\/?[a-zA-Z0-9][a-zA-Z0-9-]*$/, message: '仅支持英文、数字和连接符' },
            ]}
          >
            <Input addonBefore="/" placeholder="canvas-design" />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
}
