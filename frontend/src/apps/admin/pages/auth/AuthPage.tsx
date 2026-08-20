import { useState } from 'react';
import { Form, Input, message } from 'antd';
import {
  BarChartOutlined,
  LockOutlined,
  LoginOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { AppButton } from '@shared/components/AppButton';
import { AuthExperience } from '@shared/components/AuthExperience';
import { loginAccount } from '@shared/api/auth';
import sidebarLogo from '@shared/assets/sidebar-logo.png';
import type { AuthSession, LoginPayload } from '@shared/types';
import { t } from '@shared/i18n';

type AuthPageProps = {
  onAuthed: (session: AuthSession) => void;
};

export function AuthPage({ onAuthed }: AuthPageProps) {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<LoginPayload>();

  async function handleSubmit(values: LoginPayload) {
    setLoading(true);
    try {
      const result = await loginAccount(values);
      message.success(t("登录成功"));
      onAuthed(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("登录失败"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthExperience
      brandContext="Admin Console"
      brandName={t("萌猫 AI")}
      description={t("集中管理用户、内容案例、积分与模型配置，让每一项运营决策都有清晰入口。")}
      eyebrow={t("安全、清晰、可控的管理中心")}
      highlights={[
        { icon: <TeamOutlined />, title: t("用户与权限"), description: t("统一查看用户和权限状态") },
        { icon: <BarChartOutlined />, title: t("业务运营"), description: t("掌握积分、内容与使用情况") },
        { icon: <SettingOutlined />, title: t("系统配置"), description: t("集中维护模型和平台配置") },
      ]}
      logoSrc={sidebarLogo}
      panelDescription={t("请使用已授权的管理员账号继续访问。")}
      panelEyebrow={t("管理员入口")}
      panelFooter={<><SafetyCertificateOutlined />{t("受保护的内部管理空间")}</>}
      panelTitle={t("登录后台管理")}
      title={<>{t("让内容、用户与配置")}<br />{t("始终井然有序")}</>}
      variant="admin"
    >
      <Form
        className="auth-experience__form"
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark={false}
      >
        <Form.Item
          label={t("管理员账号")}
          name="username"
          rules={[{ required: true, min: 3, message: t("请输入至少 3 位账号") }]}
        >
          <Input
            autoComplete="username"
            prefix={<UserOutlined className="auth-experience__input-icon" />}
            placeholder={t("请输入管理员账号")}
            size="large"
          />
        </Form.Item>

        <Form.Item
          label={t("密码")}
          name="password"
          rules={[{ required: true, min: 6, message: t("请输入至少 6 位密码") }]}
        >
          <Input.Password
            autoComplete="current-password"
            prefix={<LockOutlined className="auth-experience__input-icon" />}
            placeholder={t("至少 6 位")}
            size="large"
          />
        </Form.Item>

        <AppButton
          block
          htmlType="submit"
          icon={<LoginOutlined />}
          loading={loading}
          size="large"
          tone="brand"
          type="primary"
        >
          {t("登录后台")}
        </AppButton>
      </Form>
    </AuthExperience>
  );
}
