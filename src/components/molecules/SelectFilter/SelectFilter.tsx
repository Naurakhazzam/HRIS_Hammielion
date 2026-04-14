'use client';

import { ChevronDown } from 'lucide-react';
import styles from './SelectFilter.module.css';

interface SelectFilterProps {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
}

export default function SelectFilter({
  value,
  onChange,
  options,
  placeholder = 'Semua',
}: SelectFilterProps) {
  return (
    <div className={styles.wrapper}>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className={styles.chevron} />
    </div>
  );
}
