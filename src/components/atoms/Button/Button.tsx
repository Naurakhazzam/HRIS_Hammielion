import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconOnly?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const cls = [
    styles.btn,
    styles[variant],
    styles[size],
    iconOnly ? styles.iconOnly : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} disabled={disabled || loading} {...props}>
      {loading ? <span className={styles.spinner} /> : children}
    </button>
  );
}
