import styles from './Badge.module.css';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'default' | 'primary';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export default function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {children}
    </span>
  );
}
