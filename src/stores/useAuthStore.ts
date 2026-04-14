import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types/auth.types';

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  isPreviewMode: boolean;
  togglePreviewMode: () => void;
}

// Dummy users untuk fase awal
const DUMMY_USERS: (User & { password: string })[] = [
  {
    id: 'u001', nama: 'Admin HR', email: 'admin@hammielion.com', username: 'admin',
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

      login: (identifier, password) => {
        const found = DUMMY_USERS.find(
          (u) => (u.email === identifier || u.username === identifier) && u.password === password,
        );
        if (!found) return false;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password: _password, ...user } = found;
        set({ user, isAuthenticated: true });
        return true;
      },

      logout: () => set({ user: null, isAuthenticated: false }),

      isPreviewMode: false,
      togglePreviewMode: () => set((state) => ({ isPreviewMode: !state.isPreviewMode })),
    }),
    { name: 'hris-auth' },
  ),
);
