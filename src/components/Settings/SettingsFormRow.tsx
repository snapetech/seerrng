import type { ReactNode } from 'react';

interface SettingsFormRowProps {
  htmlFor: string;
  label: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  labelClassName?: 'text-label' | 'checkbox-label';
  children: ReactNode;
  className?: string;
}

const SettingsFormRow = ({
  htmlFor,
  label,
  description,
  badge,
  labelClassName = 'text-label',
  children,
  className = '',
}: SettingsFormRowProps) => (
  <div
    className={`form-row settings-form-row ${
      description ? 'settings-form-row-with-description' : ''
    } ${className}`}
  >
    <label htmlFor={htmlFor} className={labelClassName}>
      <span className="settings-form-label-line">
        <span>{label}</span>
        {badge}
      </span>
    </label>
    <div className="form-input-area">{children}</div>
    {description && (
      <p className="settings-form-row-description">{description}</p>
    )}
  </div>
);

export default SettingsFormRow;
