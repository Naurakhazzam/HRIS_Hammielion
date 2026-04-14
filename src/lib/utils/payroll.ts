// ============================================================
// HRIS HAMMIELION — Payroll Calculation Engine
// Semua logika hitung gaji ada di sini (JANGAN scatter ke komponen)
// ============================================================

import type { RekapAbsensi } from '@/types/absensi.types';
import type { HasilKPI } from '@/types/performa.types';
import type { RekapRitase } from '@/types/driver.types';

export interface InputHitungGaji {
  gajiPokok: number;
  tunjangan: { nama: string; nominal: number }[];
  rekap: RekapAbsensi;
  hasilKPI?: HasilKPI;
  rekapRitase?: RekapRitase;    // khusus driver/kenek
  potonganMinusKasir?: number;
  potonganKehilangan?: number;
}

export interface AturanGaji {
  potonganPerMenit: number;       // Dari payrollRules.potonganTerlambat
  batasTelatBonus: number;        // Dari payrollRules.ambangDisiplinMenit
  nominalBonusDisiplin: number;   // Dari payrollRules.bonusDisiplin
  potonganTidakAbsen: number;     // Dari payrollRules.potonganAlpha
  tarifLemburPerJam?: number;
}

export interface HasilHitungGaji {
  // Pendapatan
  gajiPokok: number;
  tunjangan: { nama: string; nominal: number }[];
  bonusKedisiplinan: number;
  bonusKPI: number;
  bonusRitase: number;
  totalPendapatan: number;

  // Potongan
  potonganTerlambat: number;
  potonganTidakAbsen: number;
  potonganMinusKasir: number;
  potonganKehilangan: number;
  totalPotongan: number;

  // Take Home Pay
  thp: number;
}

export function hitungGaji(
  input: InputHitungGaji,
  aturan: AturanGaji,
): HasilHitungGaji {
  const {
    gajiPokok,
    tunjangan,
    rekap,
    hasilKPI,
    rekapRitase,
    potonganMinusKasir = 0,
    potonganKehilangan = 0,
  } = input;

  // ---- PENDAPATAN ----
  const totalTunjangan = tunjangan.reduce((sum, t) => sum + t.nominal, 0);

  const bonusKedisiplinan =
    rekap.totalMenitTerlambat < aturan.batasTelatBonus
      ? aturan.nominalBonusDisiplin
      : 0;

  const bonusKPI = hasilKPI?.bonusNominal ?? 0;
  const bonusRitase = rekapRitase?.totalPendapatan ?? 0;

  const totalPendapatan =
    gajiPokok +
    totalTunjangan +
    bonusKedisiplinan +
    bonusKPI +
    bonusRitase;

  // ---- POTONGAN ----
  const potonganTerlambat =
    rekap.totalMenitTerlambat * aturan.potonganPerMenit;

  const potonganTidakAbsen =
    rekap.totalAlpha * aturan.potonganTidakAbsen;

  const totalPotongan =
    potonganTerlambat +
    potonganTidakAbsen +
    potonganMinusKasir +
    potonganKehilangan;

  // ---- THP ----
  const thp = Math.max(0, totalPendapatan - totalPotongan);

  return {
    gajiPokok,
    tunjangan,
    bonusKedisiplinan,
    bonusKPI,
    bonusRitase,
    totalPendapatan,
    potonganTerlambat,
    potonganTidakAbsen,
    potonganMinusKasir,
    potonganKehilangan,
    totalPotongan,
    thp,
  };
}

/**
 * Hitung bonus KPI berdasarkan skor
 * bonus = (skorKPI / 100) × nominalBonus
 */
export function hitungBonusKPI(skorKPI: number, nominalBonus: number): number {
  return Math.round((skorKPI / 100) * nominalBonus);
}

/**
 * Hitung skor KPI dari checklist
 * skor = (jumlah checked × bobot masing2) / total bobot × 100
 */
export function hitungSkorKPI(
  items: { bobot: number; isChecked: boolean }[],
): number {
  const totalBobot = items.reduce((sum, i) => sum + i.bobot, 0);
  if (totalBobot === 0) return 0;
  const totalChecked = items
    .filter((i) => i.isChecked)
    .reduce((sum, i) => sum + i.bobot, 0);
  return Math.round((totalChecked / totalBobot) * 100);
}
