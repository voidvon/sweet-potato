import { useState } from "react";
import { Button, Card, Form, Input, message, Segmented } from "antd";
import {
  LoginOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { loginAccount, registerAccount } from "../../api/auth";
import appLogo from "../../assets/app-logo.png";
import type { AuthSession, LoginPayload, RegisterPayload } from "../../types";
import "./AuthPage.scss";

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
    <main className="auth-page">
      <section className="auth-hero">
        <div className="brand-pill">
          <img src={appLogo} alt="" />
          萌猫
        </div>
        <h1>登录后进入工作台</h1>
      </section>

      <Card className="auth-card">
        <Segmented
          block
          onChange={(value) => setMode(value as AuthMode)}
          options={[
            { label: "登录", value: "login" },
            { label: "注册", value: "register" },
          ]}
          value={mode}
        />

        <Form
          className="auth-form"
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
              placeholder="请输入账号"
              size="large"
            />
          </Form.Item>

          {mode === "register" && (
            <Form.Item label="用户名" name="displayName">
              <Input placeholder="请输入用户名" size="large" />
            </Form.Item>
          )}

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, min: 6, message: "请输入至少 6 位密码" }]}
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
            icon={mode === "login" ? <LoginOutlined /> : <UserAddOutlined />}
            loading={loading}
            size="large"
            type="primary"
          >
            {mode === "login" ? "登录" : "注册"}
          </Button>
        </Form>
      </Card>
    </main>
  );
}
