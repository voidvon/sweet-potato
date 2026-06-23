import { Form, type FormItemProps, type FormProps } from 'antd';
import type { ReactNode } from 'react';
import './AppForm.scss';

function joinClassName(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

type AppFormProps = Omit<FormProps, 'children'> & {
  children?: ReactNode;
};

function AppFormRoot({ className, layout = 'vertical', requiredMark = false, children, ...props }: AppFormProps) {
  return (
    <Form
      className={joinClassName('app-form', className)}
      layout={layout}
      requiredMark={requiredMark}
      {...props}
    >
      {children}
    </Form>
  );
}

export const AppForm = Object.assign(AppFormRoot, {
  Item({ className, ...props }: FormItemProps) {
    return <Form.Item className={joinClassName('app-form-item', className)} {...props} />;
  },
});
