import { InputNumber, type InputNumberProps } from 'antd';
import './AppNumberInput.scss';

export type AppNumberInputProps = InputNumberProps<number>;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function AppNumberInput({
  className,
  controls = false,
  ...props
}: AppNumberInputProps) {
  return (
    <InputNumber<number>
      className={classNames('app-number-input', className)}
      controls={controls}
      {...props}
    />
  );
}
