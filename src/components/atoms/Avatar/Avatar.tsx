import { getInisial } from '@/lib/utils/formatters';
import styles from './Avatar.module.css';

interface AvatarProps {
  nama: string;
  size?: 'sm' | 'md' | 'lg';
  src?: string;
}

export default function Avatar({ nama, size = 'md', src }: AvatarProps) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={nama}
        className={`${styles.avatar} ${styles[size]}`}
      />
    );
  }
  return (
    <div className={`${styles.avatar} ${styles[size]} ${styles.initials}`}>
      {getInisial(nama)}
    </div>
  );
}
