-- 107: Tutup Paksa Trip pengiriman toko oleh kantor (Laporan Pengiriman).
--
-- Kasus: trip cuma bisa Selesai lewat HP driver/kenek (Lapor Sampai Garasi). Kalau HP rusak,
-- driver lupa menutup, atau ada toko/retur yang tidak bisa diproses, trip tersangkut di
-- 'departed'/'closing' selamanya dan upah ritasenya tidak pernah tercatat.
--
-- - Hanya Owner/HR/Finance, alasan wajib (min. 5 huruf). Hanya trip 'departed'/'closing'
--   (trip 'ready' belum berangkat -- batalkan saja lewat Rencana).
-- - Toko yang masih 'pending' -> 'failed' dengan fail_kind pilihan kantor (default kirim_besok).
--   Trigger handle_plan_store_outcome yang mengurus Surat Jalan & paket cabangnya, sama persis
--   seperti driver menekan Kirim Besok / Gagal.
-- - Tugas belanja yang masih 'pending' dihapus (tidak ada upah). Kalau ternyata belanjanya
--   dikerjakan, susulkan lewat Susulan Belanja (migrasi 106).
-- - Retur / barang potong nota yang masih 'diambil' ditandai 'selesai' dengan catatan tutup
--   paksa (pola sama dengan force_close_tp_trip) -- kalau tidak, guard_plan_store_returns
--   menolak status 'completed'.
-- - Upah ritase dibuat seperti complete_logistics_delivery (tarif mobil x rute, tanggal trip),
--   kecuali kantor memilih tanpa upah (mis. trip ternyata tidak jalan).

alter table public.logistics_delivery_plans
  add column if not exists force_closed_by uuid default null,
  add column if not exists force_closed_by_name text,
  add column if not exists force_closed_at timestamptz,
  add column if not exists force_close_reason text,
  add column if not exists force_close_summary text;

create or replace function public.office_force_complete_plan(
  p_plan_id uuid,
  p_reason text,
  p_pending_kind text default 'kirim_besok',
  p_pay_wage boolean default true
) returns table (driver_earning numeric, helper_earning numeric, failed_stores int, removed_tasks int, closed_returns int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_emp uuid;
  v_name text;
  v_reason text := trim(coalesce(p_reason, ''));
  v_plan logistics_delivery_plans%rowtype;
  v_rate driver_rate_configs%rowtype;
  v_has_helper boolean;
  v_driver numeric := 0;
  v_helper numeric := 0;
  v_week_start date;
  v_trip_id uuid;
  v_failed int;
  v_tasks int;
  v_returns int;
begin
  select u.role, u.employee_id, e.full_name into v_role, v_emp, v_name
  from users u left join employees e on e.id = u.employee_id
  where u.id = auth.uid();
  if coalesce(v_role, '') not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang boleh menutup paksa trip.';
  end if;

  if length(v_reason) < 5 then
    raise exception 'Alasan wajib diisi (minimal 5 huruf).';
  end if;
  if p_pending_kind not in ('kirim_besok', 'gagal') then
    raise exception 'Pilih Kirim Besok atau Gagal untuk toko yang belum diproses.';
  end if;

  select * into v_plan from logistics_delivery_plans where id = p_plan_id for update;
  if not found then raise exception 'Rencana pengiriman tidak ditemukan.'; end if;
  if v_plan.status not in ('departed', 'closing') then
    raise exception 'Tutup paksa hanya untuk trip yang sedang berjalan / menuju garasi.';
  end if;

  if p_pay_wage then
    select * into v_rate from driver_rate_configs
    where vehicle_id = v_plan.vehicle_id and route_id = v_plan.route_id
    limit 1;
    if not found then
      raise exception 'Tarif untuk mobil ini di rute tersebut belum disetup (Penggajian > Tarif & Mobil Driver).';
    end if;
  end if;

  update logistics_plan_stores set
    status = 'failed', fail_kind = p_pending_kind,
    failed_reason = 'Tutup paksa kantor: ' || v_reason,
    resolved_by = v_emp, resolved_at = now()
  where plan_id = p_plan_id and status = 'pending';
  get diagnostics v_failed = row_count;

  delete from logistics_plan_supplier_tasks where plan_id = p_plan_id and status = 'pending';
  get diagnostics v_tasks = row_count;

  update logistics_store_returns set status = 'selesai',
    final_location_note = 'Tutup paksa kantor: ' || v_reason, finished_by = v_emp, finished_at = now()
  where plan_id = p_plan_id and status = 'diambil';
  get diagnostics v_returns = row_count;

  if p_pay_wage then
    v_has_helper := v_plan.helper_id is not null;
    v_driver := case when v_has_helper then v_rate.driver_rate_with_helper else v_rate.driver_rate_without_helper end;
    v_helper := case when v_has_helper then v_rate.helper_rate else 0 end;
    -- Minggu gajian driver mulai Jumat (sama dengan complete_logistics_delivery).
    v_week_start := v_plan.plan_date - ((extract(dow from v_plan.plan_date)::int - 5 + 7) % 7);

    insert into delivery_trips (
      driver_id, helper_id, vehicle_id, route_id, trip_date, has_helper,
      driver_earning, helper_earning, week_start_date, payment_status, created_by
    ) values (
      v_plan.driver_id, case when v_has_helper then v_plan.helper_id else null end,
      v_plan.vehicle_id, v_plan.route_id, v_plan.plan_date, v_has_helper,
      v_driver, v_helper, v_week_start, 'unpaid', v_plan.created_by
    ) returning id into v_trip_id;
  end if;

  update logistics_delivery_plans set
    status = 'completed',
    current_target_store_id = null,
    delivery_trip_id = v_trip_id,
    force_closed_by = auth.uid(),
    force_closed_by_name = v_name,
    force_closed_at = now(),
    force_close_reason = v_reason,
    force_close_summary = concat_ws(' · ',
      case when v_failed > 0 then v_failed || ' toko jadi ' || case when p_pending_kind = 'gagal' then 'Gagal' else 'Kirim Besok' end end,
      case when v_tasks > 0 then v_tasks || ' tugas belanja belum diproses dihapus' end,
      case when v_returns > 0 then v_returns || ' retur ditutup' end,
      case when not p_pay_wage then 'tanpa upah ritase' end)
  where id = p_plan_id;

  return query select v_driver, v_helper, v_failed, v_tasks, v_returns;
end;
$$;

revoke all on function public.office_force_complete_plan(uuid, text, text, boolean) from public, anon;
grant execute on function public.office_force_complete_plan(uuid, text, text, boolean) to authenticated;
