-- 109: Rapikan aturan penggajian yang tumpang tindih (lihat docs/ATURAN-PENGGAJIAN.md).
--
-- 1. payrolls.absent_breakdown -- snapshot rincian potongan tidak hadir + pemakaian jatah libur
--    SAAT slip dibuat (hasil lib/payrollAbsence.ts). Rincian di detail slip, slip cetak, dan
--    Ringkasan Gaji membaca snapshot ini, bukan menghitung ulang dari absensi/gaji terbaru yang
--    bisa sudah berubah. Slip lama (null) tetap dihitung ulang dengan rumus yang sama.
alter table public.payrolls add column if not exists absent_breakdown jsonb;

-- 2. KPI "Tepat Waktu" ikut toleransi absen QR 5 menit, sama seperti potongan telat di gaji
--    (lib/lateTolerance.ts: QR_LATE_TOLERANCE_MINUTES). Sebelumnya telat 1-5 menit via QR tidak
--    dipotong gajinya tapi tetap dihitung "tidak tepat waktu" di KPI.
create or replace function public.get_employee_attendance_kpi(p_employee_id uuid, p_period_start date, p_period_end date)
 returns table(punctuality_pct numeric, attendance_pct numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_join date; v_from date; v_to date := least(p_period_end, (now() at time zone 'Asia/Jakarta')::date);
  v_present_days int; v_ontime_days int;
  v_total_days int; v_offday_count int; v_required_days int;
  v_credit_on_required int; v_bonus_on_dayoff int;
begin
  select join_date into v_join from employees where id = p_employee_id;
  v_from := greatest(p_period_start, coalesce(v_join, p_period_start));
  if v_from > v_to then return; end if;

  v_total_days := (v_to - v_from) + 1;

  -- Tepat waktu = tidak telat, ATAU telat <= 5 menit lewat absen QR (toleransi HP lemot/error
  -- saat scan, sama dengan aturan potongan telat di slip gaji).
  select count(*) filter (where status = 'present'),
         count(*) filter (where status = 'present' and (coalesce(late_minutes, 0) = 0
                                                        or (source = 'qr' and late_minutes <= 5)))
    into v_present_days, v_ontime_days
  from attendances where employee_id = p_employee_id and date between v_from and v_to;

  -- employee_roster cuma nyimpen baris hari LIBUR (is_day_off = true) yg sudah disetujui/dijadwalkan;
  -- hari kerja biasa TIDAK punya baris sendiri (sparse table) -- jadi wajib kerja = total hari - libur tercatat.
  select count(*) into v_offday_count
  from employee_roster r
  where r.employee_id = p_employee_id and r.is_day_off = true and r.date between v_from and v_to;

  v_required_days := v_total_days - v_offday_count;
  if v_required_days <= 0 then
    return query select
      case when v_present_days = 0 then null else round(v_ontime_days::numeric / v_present_days * 100, 1) end,
      null::numeric;
    return;
  end if;

  -- Hari wajib kerja (bukan hari libur tercatat): hadir, ATAU sakit dgn surat dokter (sick_doc),
  -- ATAU cuti yg disetujui (leave) -- dianggap lunas. Sakit tanpa surat & izin biasa TETAP mengurangi.
  select count(*) into v_credit_on_required
  from attendances a
  where a.employee_id = p_employee_id and a.date between v_from and v_to
    and a.status in ('present', 'sick_doc', 'leave')
    and not exists (
      select 1 from employee_roster r
      where r.employee_id = a.employee_id and r.date = a.date and r.is_day_off = true
    );

  -- Bonus: tiap hari libur TERCATAT yg tetap dimasuki kerja = +1 hari wajib ekstra. Tidak dibatasi 100%.
  select count(*) into v_bonus_on_dayoff
  from attendances a
  join employee_roster r on r.employee_id = a.employee_id and r.date = a.date
  where a.employee_id = p_employee_id and a.date between v_from and v_to
    and r.is_day_off = true and a.status = 'present';

  return query select
    case when v_present_days = 0 then null else round(v_ontime_days::numeric / v_present_days * 100, 1) end,
    round((v_credit_on_required + v_bonus_on_dayoff)::numeric / v_required_days * 100, 1);
end
$function$;

-- 3. Finance ikut membuat slip gaji, tapi selama ini TIDAK bisa membaca jadwal libur & pengajuan
--    libur (RLS cuma owner/hr/diri sendiri). Akibatnya slip yang dibuat Finance menganggap hari
--    libur terjadwal sebagai "hari kosong" dan denda disiplin Ajukan Libur terbaca Rp0. Finance
--    cukup diberi akses BACA.
drop policy if exists roster_read_finance on public.employee_roster;
create policy roster_read_finance on public.employee_roster
  for select using (get_my_role() = 'finance'::user_role);

drop policy if exists roster_pick_requests_select_finance on public.roster_pick_requests;
create policy roster_pick_requests_select_finance on public.roster_pick_requests
  for select using (get_my_role() = 'finance'::user_role);
