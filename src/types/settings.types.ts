import { Cabang } from '@/lib/constants/roles';

export interface ShiftConfig {
  id: string;
  nama: string;
  jamMasuk: string; // HH:mm
  jamPulang: string; // HH:mm
  toleransiMenit: number;
}

export interface PayrollRuleConfig {
  potonganTerlambat: number; // per menit
  potonganAlpha: number; // per kejadian
  bonusDisiplin: number;
  ambangDisiplinMenit: number; // total menit terlambat maksimal untuk dapat bonus
  masterAuthCode: string; // Kode untuk absen di cabang bukan utama
}

export interface BranchConfig {
  nama: Cabang;
  latitude: number;
  longitude: number;
  radiusMeter: number;
}

export interface SettingsState {
  shifts: ShiftConfig[];
  payrollRules: PayrollRuleConfig;
  branches: BranchConfig[];
}
