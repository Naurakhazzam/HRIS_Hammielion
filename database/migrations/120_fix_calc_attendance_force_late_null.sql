-- 120: Perbaiki trigger calc_attendance_times -- telat & lembur ikut dihitung ulang dari jadwal
-- di SETIAP update baris absensi, bukan cuma saat jam masuk berubah.
--
-- Penyebab: v_force_late := TG_OP = 'UPDATE' AND current_setting('app.recalc_late', true) = 'on'.
-- Kalau setting app.recalc_late belum pernah di-set di sesi itu, current_setting(..., true)
-- mengembalikan NULL -> v_force_late = NULL -> "NOT v_force_late" juga NULL -> early return
-- (jam masuk tidak berubah) tidak pernah jalan. Akibatnya edit telat manual di Rekap Absensi,
-- kompensasi klarifikasi telat yang disetujui HR, dll tertimpa lagi oleh hitungan jadwal setiap
-- kali baris itu di-update (termasuk saat ACC lembur).
--
-- Fix: coalesce ke '' supaya v_force_late selalu true/false. Isi fungsi lainnya tidak berubah.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.calc_attendance_times'::regproc);
  if position($q$current_setting('app.recalc_late', true) = 'on'$q$ in v_def) = 0 then
    raise exception 'Pola v_force_late tidak ditemukan -- periksa calc_attendance_times secara manual';
  end if;
  v_def := replace(v_def,
    $q$current_setting('app.recalc_late', true) = 'on'$q$,
    $q$coalesce(current_setting('app.recalc_late', true), '') = 'on'$q$);
  execute v_def;
end $$;
