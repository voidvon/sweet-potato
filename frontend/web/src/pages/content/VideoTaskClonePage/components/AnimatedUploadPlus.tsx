import { Plus } from 'lucide-react';
import './AnimatedUploadPlus.scss';

type AnimatedUploadPlusProps = {
  className?: string;
  size?: number;
  strokeWidth?: number;
};

export function AnimatedUploadPlus({
  className,
  size = 24,
  strokeWidth,
}: AnimatedUploadPlusProps) {
  return (
    <Plus
      aria-hidden="true"
      className={['animated-upload-plus', className].filter(Boolean).join(' ')}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
