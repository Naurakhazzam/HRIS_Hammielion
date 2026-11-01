-- 112: Pro-rata gaji untuk karyawan resign / masuk kembali di tengah periode.
--
-- Masalah (kasus nyata: Annisa Nurbaeti, Juni & Oktober 2026):
-- 1. Resign dicatat sebagai absen "Izin" (keterangan 'Resign') di Rekap Absensi, jadi hari-hari
--    SETELAH resign dipotong sebagai tidak hadir (1/26 gaji per hari) -- lebih berat dari pro-rata
--    dan memakai jatah libur.
-- 2. Karyawan yang masuk kembali (rehire) tetap memakai join_date lama, sehingga hari sebelum
--    masuk kembali dianggap hari kosong -> Alpha berjenjang.
--
-- Solusi:
-- - employees.last_working_date = tanggal TERAKHIR bekerja (null = masih bekerja). Hari setelah
--   tanggal ini tidak dihitung sama sekali (bukan tidak hadir), dan gaji pokok + tunjangan
--   di-pro-rata (lib/payrollAbsence.ts calcProRataFactor) -- berlaku untuk permanent & training.
-- - Masuk kembali = ubah join_date ke tanggal masuk baru & kosongkan last_working_date.
-- - detect_unexplained_absences tidak lagi menandai Alpha di luar masa kerja.

alter table public.employees add column if not exists last_working_date date;
comment on column public.employees.last_working_date is
  'Tanggal terakhir bekerja (resign). Null = masih bekerja. Gaji periode itu di-pro-rata, hari sesudahnya tidak dihitung tidak hadir.';

create or replace function public.detect_unexplained_absences()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_period_end   date;
  v_period_start date;
  v_count        integer := 0;
  v_emp          record;
  v_d            date;
  v_until        date;
begin
  if get_my_role() not in ('owner', 'hr') then
    raise exception 'Tidak diizinkan';
  end if;

  v_period_end := (date_trunc('month', current_date) + interval '24 days')::date;
  if current_date > v_period_end then
    v_period_end := (date_trunc('month', current_date) + interval '1 month' + interval '24 days')::date;
  end if;
  v_period_start := (v_period_end - interval '1 month' + interval '1 day')::date;

  for v_emp in
    select e.id, e.join_date, e.last_working_date
    from employees e
    left join positions p on p.id = e.position_id
    left join branches b on b.id = e.branch_id
    where e.is_active = true
      and e.employee_type in ('permanent', 'training')
      and coalesce(e.flat_salary, false) = false
      and coalesce(p.name, '') != 'Owner'
      and not (coalesce(p.name, '') = 'Helper' and coalesce(b.name, '') = 'Gudang')
  loop
    v_d := greatest(v_period_start, coalesce(v_emp.join_date, v_period_start));
    v_until := least(current_date - 1, coalesce(v_emp.last_working_date, current_date - 1));
    while v_d <= v_until loop
      if not exists (select 1 from attendances where employee_id = v_emp.id and date = v_d)
         and not exists (select 1 from employee_roster where employee_id = v_emp.id and date = v_d and is_day_off = true)
         and not exists (select 1 from company_holidays where holiday_date = v_d)
         and not exists (
           select 1 from leave_requests
           where employee_id = v_emp.id and status in ('pending', 'approved')
             and v_d between start_date and end_date
         )
      then
        insert into attendances (employee_id, date, check_in, check_out, late_minutes, overtime_hours, status, source, notes, auto_flagged)
        values (v_emp.id, v_d, null, null, 0, 0, 'absent', 'manual', 'Tidak ada absen sama sekali - otomatis ditandai Alpha, menunggu klarifikasi karyawan', true)
        on conflict (employee_id, date) do nothing;
        v_count := v_count + 1;
      end if;
      v_d := v_d + 1;
    end loop;
  end loop;

  return v_count;
end;
$function$;

create or replace function public.detect_unexplained_absences(p_start_date date default null::date, p_end_date date default null::date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_range_start date;
  v_range_end   date;
  v_count       integer := 0;
  v_emp         record;
  v_d           date;
  v_until       date;
begin
  if get_my_role() not in ('owner', 'hr') then
    raise exception 'Tidak diizinkan';
  end if;

  if p_start_date is not null and p_end_date is not null then
    if p_start_date > p_end_date then
      raise exception 'Tanggal awal tidak boleh setelah tanggal akhir';
    end if;
    v_range_start := p_start_date;
    v_range_end   := least(p_end_date, current_date - 1);
  else
    v_range_end   := current_date - 1;
    v_range_start := current_date - 35;
  end if;

  for v_emp in
    select e.id, e.join_date, e.last_working_date
    from employees e
    left join positions p on p.id = e.position_id
    left join branches b on b.id = e.branch_id
    where e.is_active = true
      and e.employee_type in ('permanent', 'training')
      and coalesce(e.flat_salary, false) = false
      and coalesce(p.name, '') != 'Owner'
      and not (coalesce(p.name, '') = 'Helper' and coalesce(b.name, '') = 'Gudang')
  loop
    v_d := greatest(v_range_start, coalesce(v_emp.join_date, v_range_start));
    v_until := least(v_range_end, coalesce(v_emp.last_working_date, v_range_end));
    while v_d <= v_until loop
      if not exists (select 1 from attendances where employee_id = v_emp.id and date = v_d)
         and not exists (select 1 from employee_roster where employee_id = v_emp.id and date = v_d and is_day_off = true)
         and not exists (select 1 from company_holidays where holiday_date = v_d)
         and not exists (
           select 1 from leave_requests
           where employee_id = v_emp.id and status in ('pending', 'approved')
             and v_d between start_date and end_date
         )
      then
        insert into attendances (employee_id, date, check_in, check_out, late_minutes, overtime_hours, status, source, notes, auto_flagged)
        values (v_emp.id, v_d, null, null, 0, 0, 'absent', 'manual', 'Tidak ada absen sama sekali - otomatis ditandai Alpha, menunggu klarifikasi karyawan', true)
        on conflict (employee_id, date) do nothing;
        v_count := v_count + 1;
      end if;
      v_d := v_d + 1;
    end loop;
  end loop;

  return v_count;
end;
$function$;
