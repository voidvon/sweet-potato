import { Button, Result } from 'antd';
import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { routePaths } from '../routes/paths';
import './NoPermissionPage.scss';

type NoPermissionPageProps = {
  canAccessAccount: boolean;
};

export function NoPermissionPage({ canAccessAccount }: NoPermissionPageProps) {
  const navigate = useNavigate();

  return (
    <main className="no-permission-page">
      <Result
        extra={canAccessAccount ? (
          <Button onClick={() => navigate(routePaths.account)} type="primary">
            前往账号中心
          </Button>
        ) : null}
        icon={<ShieldAlert size={32} />}
        status="403"
        subTitle="当前账号已登录，但未被授予可访问的 Web 功能模块。请联系管理员分配角色权限。"
        title="暂无可用功能权限"
      />
    </main>
  );
}
