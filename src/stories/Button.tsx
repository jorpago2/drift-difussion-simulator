import { Button as CarbonButton } from '@carbon/react';

export interface ButtonProps {
  /** Is this the principal call to action on the page? */
  primary?: boolean;
  /** How large should the button be? */
  size?: 'small' | 'medium' | 'large';
  /** Button contents */
  label: string;
  /** Optional click handler */
  onClick?: () => void;
}

/** Primary UI component for user interaction */
export const Button = ({
  primary = false,
  size = 'medium',
  label,
  ...props
}: ButtonProps) => {
  return (
    <CarbonButton
      type="button"
      kind={primary ? 'primary' : 'secondary'}
      size={size === 'small' ? 'sm' : size === 'large' ? 'lg' : 'md'}
      {...props}
    >
      {label}
    </CarbonButton>
  );
};
