import { Zap, type LucideProps } from 'lucide-react';

export function CreditIcon({ className, fill = 'currentColor', size = 12, ...props }: LucideProps) {
  return (
    <Zap
      {...props}
      aria-hidden="true"
      className={['credit-icon', className].filter(Boolean).join(' ')}
      fill={fill}
      size={size}
    />
  );
}
