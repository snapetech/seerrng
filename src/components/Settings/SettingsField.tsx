import SelectionCircle from '@app/components/Common/SelectionCircle';
import { notifySettingsUserChange } from '@app/components/Settings/settingsEvents';
import { Field as FormikField, useField, type FieldAttributes } from 'formik';
import type { ChangeEvent } from 'react';

interface SettingsFieldProps {
  name: string;
  type?: string;
  id?: string;
  disabled?: boolean;
  'data-testid'?: string;
  [key: string]: unknown;
}

const SettingsCheckboxField = ({
  id,
  name,
  disabled,
  'data-testid': dataTestId,
  onChange,
}: SettingsFieldProps) => {
  const [field, , helpers] = useField<boolean>({ name, type: 'checkbox' });

  return (
    <SelectionCircle
      id={id}
      name={name}
      data-testid={dataTestId}
      selected={Boolean(field.value)}
      disabled={Boolean(disabled)}
      onBlur={() => void helpers.setTouched(true)}
      onClick={() => {
        const checked = !Boolean(field.value);
        void helpers.setValue(checked);
        notifySettingsUserChange();

        if (typeof onChange === 'function') {
          const checkboxOnChange = onChange as (
            event: ChangeEvent<HTMLInputElement>
          ) => void;
          checkboxOnChange({
            target: { checked, name },
            currentTarget: { checked, name },
          } as ChangeEvent<HTMLInputElement>);
        }
      }}
    />
  );
};

const SettingsField = (props: SettingsFieldProps) =>
  props.type === 'checkbox' ? (
    <SettingsCheckboxField {...props} />
  ) : (
    <FormikField {...(props as FieldAttributes<unknown>)} />
  );

export default SettingsField;
