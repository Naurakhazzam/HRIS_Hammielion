import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SettingsState, ShiftConfig, PayrollRuleConfig, BranchConfig } from '@/types/settings.types';

interface SettingsActions {
  // Shift actions
  addShift: (shift: Omit<ShiftConfig, 'id'>) => void;
  updateShift: (id: string, shift: Partial<ShiftConfig>) => void;
  deleteShift: (id: string) => void;
  
  // Rule actions
  updatePayrollRules: (rules: Partial<PayrollRuleConfig>) => void;
  
  // Branch actions
  updateBranch: (nama: string, config: Partial<BranchConfig>) => void;
}

type SettingsStore = SettingsState & SettingsActions;

const INITIAL_SHIFTS: ShiftConfig[] = [
  { id: 's1', nama: 'Pagi', jamMasuk: '08:00', jamPulang: '16:00', toleransiMenit: 15 },
  { id: 's2', nama: 'Siang', jamMasuk: '12:00', jamPulang: '20:00', toleransiMenit: 15 },
];

const INITIAL_RULES: PayrollRuleConfig = {
  potonganTerlambat: 1500,
  potonganAlpha: 75000,
  bonusDisiplin: 150000,
  ambangDisiplinMenit: 30,
};

const INITIAL_BRANCHES: BranchConfig[] = [
  { nama: 'Cabang 1', latitude: -6.2088, longitude: 106.8456, radiusMeter: 100 },
  { nama: 'Cabang 2', latitude: -6.2300, longitude: 106.8200, radiusMeter: 100 },
  { nama: 'Cabang 3', latitude: -6.1750, longitude: 106.8650, radiusMeter: 100 },
  { nama: 'Cabang 4', latitude: -6.2500, longitude: 106.7900, radiusMeter: 100 },
  { nama: 'Cabang 5', latitude: -6.1900, longitude: 106.8100, radiusMeter: 100 },
];

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      shifts: INITIAL_SHIFTS,
      payrollRules: INITIAL_RULES,
      branches: INITIAL_BRANCHES,

      addShift: (shift) => set((state) => ({
        shifts: [...state.shifts, { ...shift, id: `s${Date.now()}` }]
      })),

      updateShift: (id, data) => set((state) => ({
        shifts: state.shifts.map((s) => s.id === id ? { ...s, ...data } : s)
      })),

      deleteShift: (id) => set((state) => ({
        shifts: state.shifts.filter((s) => s.id !== id)
      })),

      updatePayrollRules: (data) => set((state) => ({
        payrollRules: { ...state.payrollRules, ...data }
      })),

      updateBranch: (nama, data) => set((state) => ({
        branches: state.branches.map((b) => b.nama === nama ? { ...b, ...data } : b)
      })),
    }),
    {
      name: 'hris-settings',
    }
  )
);
