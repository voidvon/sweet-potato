import { Button, type ButtonProps } from 'antd'
import { forwardRef } from 'react'
import './CompactButton.scss'

export type CompactButtonProps = ButtonProps

export const CompactButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, CompactButtonProps>(function CompactButton({
  children,
  className,
  color = 'default',
  icon,
  size = 'small',
  variant = 'filled',
  ...props
}, ref) {
  return (
    <Button
      className={['compact-button', className].filter(Boolean).join(' ')}
      color={color}
      icon={icon}
      ref={ref}
      size={size}
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  )
})
