import { Button, type ButtonProps } from 'antd';
import './AppButton.scss';

export type AppButtonProps = ButtonProps & {
  tone?: 'default' | 'brand';
};

export function AppButton({
  className,
  tone = 'default',
  ...buttonProps
}: AppButtonProps) {
  const classes = [
    'app-button',
    tone === 'brand' ? 'app-button--brand' : '',
    className,
  ].filter(Boolean).join(' ');

  return <Button {...buttonProps} className={classes} />;
}
