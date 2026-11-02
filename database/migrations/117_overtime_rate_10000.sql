-- 117: Tarif lembur naik jadi Rp10.000/jam untuk semua staff, mulai periode Oktober 2026
-- (26 Sep - 25 Okt 2026). Keputusan Owner, November 2026.
--
-- Slip memakai baris salary_components terakhir dengan effective_date <= tanggal 25 akhir
-- periode. Supaya periode September ke belakang (sudah dibayar) tidak berubah:
--   1. Baris yang berlaku mulai 26 Sep 2026 langsung diubah tarif lemburnya.
--   2. Karyawan yang baris yang berlaku di periode Oktober (terakhir <= 25 Okt) masih bertanggal
--      SEBELUM 26 Sep dapat baris baru per 26 Sep 2026: salinan baris itu, cuma tarif lemburnya
--      10.000. (Termasuk karyawan yang sudah punya baris baru per November.)
-- Sudah dijalankan 2 Nov 2026 lewat API (Supabase MCP sedang putus): 1 baris default, 7 baris
-- diubah, 23 baris ditambah. Hasil: 28 karyawan Rp10.000 di periode Oktober.
-- Team Gudang & karyawan overtime_applicable = false tetap tidak dapat lembur (diatur di tempat
-- lain, bukan lewat tarif ini). Karyawan gaji flat juga tetap tanpa lembur.

update salary_defaults set overtime_rate_per_hour = 10000;

update salary_components set overtime_rate_per_hour = 10000 where effective_date >= '2026-09-26';

insert into salary_components (employee_id, base_salary, position_allowance, meal_allowance, overtime_rate_per_hour, late_penalty_per_minute, effective_date, special_allowance)
select distinct on (sc.employee_id)
  sc.employee_id, sc.base_salary, sc.position_allowance, sc.meal_allowance, 10000, sc.late_penalty_per_minute, '2026-09-26', sc.special_allowance
from salary_components sc
where sc.effective_date < '2026-09-26'
  and not exists (select 1 from salary_components x where x.employee_id = sc.employee_id and x.effective_date between '2026-09-26' and '2026-10-25')
order by sc.employee_id, sc.effective_date desc;
