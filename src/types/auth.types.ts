import type { UserRole } from '@/lib/constants/roles';

export interface User {
  id: string;
  nama: string;
  email: string;
  role: UserRole;
  karyawanId?: string; // jika role adalah karyawan/manager
  avatar?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
}
