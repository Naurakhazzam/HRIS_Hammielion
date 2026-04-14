'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, CalendarCheck, TrendingUp, Truck,
  Wallet, UmbrellaOff, FileBarChart, Settings, ChevronDown,
  LogOut,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NAV } from '@/lib/constants/navigation';
import { ROLES } from '@/lib/constants/roles';
import { useAuthStore } from '@/stores/useAuthStore';
import Avatar from '@/components/atoms/Avatar';
import styles from './Sidebar.module.css';

const ICONS: Record<string, React.ElementType> = {
  LayoutDashboard, Users, CalendarCheck, TrendingUp, Truck,
  Wallet, UmbrellaOff, FileBarChart, Settings,
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [openMenus, setOpenMenus] = useState<string[]>([]);

  const toggleMenu = (label: string) => {
    setOpenMenus((prev) =>
      prev.includes(label) ? prev.filter((m) => m !== label) : [...prev, label],
    );
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoText}>HRIS</div>
        <div className={styles.logoSub}>Hammielion Petshop</div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {NAV.map((item) => {
          const Icon = ICONS[item.icon] ?? Settings;
          const isActive = pathname.startsWith(item.basePath);
          const isOpen = openMenus.includes(item.label);
          const hasSubs = item.subs.length > 0;

          if (!hasSubs) {
            return (
              <div key={item.label} className={styles.navGroup}>
                <Link
                  href={item.basePath}
                  className={`${styles.navParent} ${isActive ? styles.navParentActive : ''}`}
                >
                  <div className={styles.navParentLeft}>
                    <Icon className={styles.navIcon} />
                    <span className={styles.navLabel}>{item.label}</span>
                  </div>
                </Link>
              </div>
            );
          }

          return (
            <div key={item.label} className={styles.navGroup}>
              <div
                className={`${styles.navParent} ${isActive ? styles.navParentActive : ''}`}
                onClick={() => toggleMenu(item.label)}
              >
                <div className={styles.navParentLeft}>
                  <Icon className={styles.navIcon} />
                  <span className={styles.navLabel}>{item.label}</span>
                </div>
                <ChevronDown
                  className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
                />
              </div>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className={styles.subMenu}
                  >
                    {item.subs.map((sub) => {
                      const subActive = pathname === sub.path;
                      return (
                        <Link
                          key={sub.path}
                          href={sub.path}
                          className={`${styles.subItem} ${subActive ? styles.subItemActive : ''}`}
                        >
                          {sub.label}
                        </Link>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* User Footer */}
      <div className={styles.footer}>
        <div className={styles.userInfo}>
          <Avatar nama={user?.nama ?? 'User'} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={`${styles.userName} truncate`}>{user?.nama}</div>
            <div className={styles.userRole}>
              {user ? ROLES[user.role].label : ''}
            </div>
          </div>
          <LogOut
            size={16}
            style={{ color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}
            onClick={handleLogout}
          />
        </div>
      </div>
    </aside>
  );
}
