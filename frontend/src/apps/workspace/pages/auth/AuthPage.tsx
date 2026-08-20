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
import sidebarLogo from "@shared/assets/sidebar-logo.png";
import type { AuthSession, LoginPayload } from "../../types";
import { t } from '@shared/i18n';

type AuthMode = "login" | "register";

type AuthFormValues = LoginPayload & {
  confirmPassword?: string;
};

type AuthPageProps = {
  onAuthed: (session: AuthSession) => void;
};

export function AuthPage({ onAuthed }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<AuthFormValues>();

  async function handleSubmit(values: AuthFormValues) {
    setLoading(true);
    try {
      const payload = { username: values.username, password: values.password };
      const result = mode === "login" ? await loginAccount(payload) : await registerAccount(payload);
      message.success(mode === "login" ? t("登录成功") : t("注册成功"));
      onAuthed(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("登录失败"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthExperience
      brandContext="AI Creative Workspace"
      brandName={t("地瓜 AI")}
      description={t("从灵感、提示词到图片与视频作品，在一个更专注、更顺畅的创作空间里完成。")}
      eyebrow={t("让每一个灵感更快成为作品")}
      highlights={[
        { icon: <FileImageOutlined />, title: t("智能生图"), description: t("快速生成与精修视觉素材") },
        { icon: <PlayCircleOutlined />, title: t("视频创作"), description: t("覆盖口播与内容生产流程") },
        { icon: <ThunderboltOutlined />, title: t("高效工作流"), description: t("素材、任务与作品统一管理") },
      ]}
      logoSrc={sidebarLogo}
      panelDescription={mode === 'login' ? t("登录后继续管理素材与创作任务。") : t("只需一个账号，开启你的 AI 创作空间。")}
      panelEyebrow={mode === 'login' ? t("欢迎回来") : t("开始创作")}
      panelFooter={<><SafetyCertificateOutlined />{t("账号信息将被安全加密保护")}</>}
      panelTitle={mode === 'login' ? t("继续你的创作") : t("创建创作空间")}
      title={<>{t("一站式完成")}<br />{t("图片与视频创作")}</>}
    >
      <Segmented
        block
        onChange={(value) => {
          setMode(value as AuthMode);
          form.setFieldsValue({ password: '' });
        }}
        options={[
          { label: t("登录"), value: "login" },
          { label: t("注册"), value: "register" },
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
          label={t("账号")}
          name="username"
          rules={[{ required: true, min: 3, message: t("请输入至少 3 位账号") }]}
        >
          <Input
            autoComplete="username"
            prefix={<UserOutlined className="auth-experience__input-icon" />}
            placeholder={t("请输入账号")}
            size="large"
          />
        </Form.Item>

        <Form.Item
          label={t("密码")}
          name="password"
          rules={[{ required: true, min: 6, message: t("请输入至少 6 位密码") }]}
        >
          <Input.Password
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            prefix={<LockOutlined className="auth-experience__input-icon" />}
            placeholder={t("至少 6 位")}
            size="large"
          />
        </Form.Item>

        {mode === "register" && (
          <Form.Item
            dependencies={["password"]}
            label={t("确认密码")}
            name="confirmPassword"
            rules={[
              { required: true, message: t("请再次输入密码") },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t("两次输入的密码不一致")));
                },
              }),
            ]}
          >
            <Input.Password
              autoComplete="new-password"
              prefix={<LockOutlined className="auth-experience__input-icon" />}
              placeholder={t("请再次输入密码")}
              size="large"
            />
          </Form.Item>
        )}

        <AppButton
          block
          htmlType="submit"
          icon={mode === "login" ? <LoginOutlined /> : <UserAddOutlined />}
          loading={loading}
          size="large"
          tone="brand"
          type="primary"
        >
          {mode === "login" ? t("登录") : t("注册")}
        </AppButton>
      </Form>
    </AuthExperience>
  );
}
