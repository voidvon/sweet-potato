import { useState } from "react";
import { Form, Input, message, Segmented } from "antd";
import {
  FileImageOutlined,
  LoginOutlined,
  LockOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { AppButton } from '@shared/components/AppButton';
import { AuthExperience } from '@shared/components/AuthExperience';
import { loginAccount, registerAccount } from "../../api/auth";
import appLogo from "@shared/assets/app-logo.png";
import type { AuthSession, LoginPayload, RegisterPayload } from "../../types";

type AuthMode = "login" | "register";

type AuthPageProps = {
  onAuthed: (session: AuthSession) => void;
};

export function AuthPage({ onAuthed }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<LoginPayload | RegisterPayload>();

  async function handleSubmit(values: LoginPayload | RegisterPayload) {
    setLoading(true);
    try {
      const action = mode === "login" ? loginAccount : registerAccount;
      const result = await action(values);
      message.success(mode === "login" ? "登录成功" : "注册成功");
      onAuthed(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthExperience
      brandContext="AI Creative Workspace"
      brandName="萌猫 AI"
      description="从灵感、提示词到图片与视频作品，在一个更专注、更顺畅的创作空间里完成。"
      eyebrow="让每一个灵感更快成为作品"
      highlights={[
        { icon: <FileImageOutlined />, title: '智能生图', description: '快速生成与精修视觉素材' },
        { icon: <PlayCircleOutlined />, title: '视频创作', description: '覆盖口播与内容生产流程' },
        { icon: <ThunderboltOutlined />, title: '高效工作流', description: '素材、任务与作品统一管理' },
      ]}
      logoSrc={appLogo}
      panelDescription={mode === 'login' ? '登录后继续管理素材与创作任务。' : '只需一个账号，开启你的 AI 创作空间。'}
      panelEyebrow={mode === 'login' ? '欢迎回来' : '开始创作'}
      panelFooter={<><SafetyCertificateOutlined />账号信息将被安全加密保护</>}
      panelTitle={mode === 'login' ? '继续你的创作' : '创建创作空间'}
      title={<>一站式完成<br />图片与视频创作</>}
    >
      <Segmented
        block
        onChange={(value) => {
          setMode(value as AuthMode);
          form.setFieldsValue({ password: '' });
        }}
        options={[
          { label: "登录", value: "login" },
          { label: "注册", value: "register" },
        ]}
        value={mode}
      />

      <Form
        className="auth-experience__form"
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark={false}
      >
        <Form.Item
          label="账号"
          name="username"
          rules={[{ required: true, min: 3, message: "请输入至少 3 位账号" }]}
        >
          <Input
            autoComplete="username"
            prefix={<UserOutlined className="auth-experience__input-icon" />}
            placeholder="请输入账号"
            size="large"
          />
        </Form.Item>

        {mode === "register" && (
          <Form.Item label="用户名" name="displayName">
            <Input
              autoComplete="nickname"
              prefix={<UserAddOutlined className="auth-experience__input-icon" />}
              placeholder="请输入用户名"
              size="large"
            />
          </Form.Item>
        )}

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, min: 6, message: "请输入至少 6 位密码" }]}
        >
          <Input.Password
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            prefix={<LockOutlined className="auth-experience__input-icon" />}
            placeholder="至少 6 位"
            size="large"
          />
        </Form.Item>

        <AppButton
          block
          htmlType="submit"
          icon={mode === "login" ? <LoginOutlined /> : <UserAddOutlined />}
          loading={loading}
          size="large"
          tone="brand"
          type="primary"
        >
          {mode === "login" ? "登录" : "注册"}
        </AppButton>
      </Form>
    </AuthExperience>
  );
}
