import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types/auth.types';

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
}

// Dummy users untuk fase awal
const DUMMY_USERS: (User & { password: string })[] = [
  {
    id: 'u001', nama: 'Admin HR', email: 'admin@hammielion.com',
    password: 'admin123', role: 'admin_hr',
  },
  {
    id: 'u002', nama: 'Owner', email: 'owner@hammielion.com',
    password: 'owner123', role: 'owner',
  },
  {
    id: 'u003', nama: 'Budi Santoso', email: 'budi@hammielion.com',
    password: 'karyawan123', role: 'karyawan', karyawanId: 'k001',
  },
];

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: (email, password) => {
        const found = DUMMY_USERS.find(
          (u) => u.email === email && u.password === password,
        );
        if (!found) return false;
        const { password: _, ...user } = found;
        set({ user, isAuthenticated: true });
        return true;
      },

      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    { name: 'hris-auth' },
  ),
);
