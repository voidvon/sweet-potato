import { useState } from 'react';
import { Button, Card, Form, Input, message } from 'antd';
import { LoginOutlined } from '@ant-design/icons';
import { loginAccount } from '@shared/api/auth';
import appLogo from '@shared/assets/app-logo.png';
import type { AuthSession, LoginPayload } from '@shared/types';
import './AuthPage.scss';

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
      message.success('登录成功');
      onAuthed(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-hero">
        <div className="admin-brand-pill">
          <img src={appLogo} alt="" />
          萌猫后台
        </div>
        <h1>登录后台管理</h1>
        <p>仅限管理员账号访问用户、积分和模型配置。</p>
      </section>

      <Card className="admin-auth-card">
        <Form
          className="admin-auth-form"
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
        >
          <Form.Item
            label="管理员账号"
            name="username"
            rules={[{ required: true, min: 3, message: '请输入至少 3 位账号' }]}
          >
            <Input
              autoComplete="username"
              placeholder="请输入管理员账号"
              size="large"
            />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, min: 6, message: '请输入至少 6 位密码' }]}
          >
            <Input.Password
              autoComplete="current-password"
              placeholder="至少 6 位"
              size="large"
            />
          </Form.Item>

          <Button
            block
            htmlType="submit"
            icon={<LoginOutlined />}
            loading={loading}
            size="large"
            type="primary"
          >
            登录后台
          </Button>
        </Form>
      </Card>
    </main>
  );
}
