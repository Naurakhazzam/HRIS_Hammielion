'use client';

import { Search, X } from 'lucide-react';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Cari...',
}: SearchBarProps) {
  return (
    <div className={styles.wrapper}>
      <Search size={16} className={styles.icon} />
      <input
        type="text"
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button className={styles.clear} onClick={() => onChange('')} type="button">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
