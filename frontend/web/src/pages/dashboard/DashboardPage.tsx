import { Navigate, useParams } from 'react-router-dom';
import { ChevronRight, Play } from 'lucide-react';
import { modules } from '../../modules';
import { ChatPage } from '../chat/ChatPage';

export function DashboardPage() {
  const { moduleId } = useParams();
  const activeModule = modules.find((item) => item.id === moduleId && item.id !== 'account');

  if (!activeModule) {
    return <Navigate to="/app/modules/claw" replace />;
  }

  if (activeModule.id === 'claw') {
    return <ChatPage />;
  }

  const ActiveIcon = activeModule.icon;

  return (
    <>
    </>
  );
}
