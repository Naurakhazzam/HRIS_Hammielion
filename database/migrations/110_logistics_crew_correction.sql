-- 110: Koreksi Mobil / Driver / Kenek trip pengiriman oleh kantor (Laporan Pengiriman).
--
-- Kasus: salah pilih mobil, driver, atau kenek di rencana (atau di lapangan ternyata tukar
-- orang/mobil). Ganti Driver/Kenek di Detail Rencana cuma sampai trip berjalan dan tanpa jejak;
-- setelah Selesai, upah ritase sudah tercatat atas nama orang & tarif mobil yang salah.
--
-- - Hanya Owner/HR/Finance, alasan wajib (min. 5 huruf). Semua status kecuali 'cancelled'.
-- - Tiap koreksi tercatat di logistics_crew_corrections (data & total upah lama/baru).
-- - Kalau upah sudah tercatat (trip utama + tiap belanja selesai, masing-masing satu baris
--   delivery_trips), semua baris ikut dipindah ke orang/mobil baru. Upah dihitung ulang dari
--   tarif mobil x rute HANYA kalau mobil berubah atau kenek ditambah/dihapus (tarif driver
--   dengan/tanpa kenek beda); ganti orang saja -> nominal tetap.
-- - Ditolak kalau ada upah driver/kenek trip itu yang SUDAH dibayar -- koreksi lewat Penggajian.
-- - Ditolak kalau mobil baru sedang dipakai trip lain yang masih berjalan di tanggal yang sama.
-- - Retur yang sedang dibawa ikut pindah ke driver baru lewat trigger guard_plan_store_returns.

create table if not exists public.logistics_crew_corrections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.logistics_delivery_plans(id) on delete cascade,
  old_vehicle_id uuid references public.vehicles(id),
  new_vehicle_id uuid not null references public.vehicles(id),
  old_driver_id uuid references public.employees(id),
  new_driver_id uuid not null references public.employees(id),
  old_helper_id uuid references public.employees(id),
  new_helper_id uuid references public.employees(id),
  -- Total semua baris delivery_trips plan ini (trip utama + belanja); null = upah belum tercatat.
  old_driver_earning numeric(12,2),
  new_driver_earning numeric(12,2),
  old_helper_earning numeric(12,2),
  new_helper_earning numeric(12,2),
  trips_updated int not null default 0,
  reason text not null,
  corrected_by uuid default auth.uid(),
  corrected_by_name text,
  corrected_at timestamptz not null default now()
);

create index if not exists logistics_crew_corrections_plan_idx on public.logistics_crew_corrections(plan_id);

alter table public.logistics_crew_corrections enable row level security;

-- Baca: sama seperti Laporan Pengiriman (Owner/HR/Finance/Kepala Gudang). Tulis hanya lewat RPC.
drop policy if exists logistics_crew_corrections_select on public.logistics_crew_corrections;
create policy logistics_crew_corrections_select on public.logistics_crew_corrections
  for select to authenticated using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('owner', 'hr', 'finance'))
    or exists (
      select 1 from public.users u
      join public.employees e on e.id = u.employee_id
      join public.positions p on p.id = e.position_id
      where u.id = auth.uid() and p.name = 'Kepala Gudang'
    )
  );

create or replace function public.office_change_plan_crew(
  p_plan_id uuid,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_helper_id uuid,
  p_reason text
) returns table (old_driver_earning numeric, new_driver_earning numeric, old_helper_earning numeric, new_helper_earning numeric, trips_updated int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_reason text := trim(coalesce(p_reason, ''));
  v_plan logistics_delivery_plans%rowtype;
  v_trip delivery_trips%rowtype;
  v_rate driver_rate_configs%rowtype;
  v_has_helper boolean := p_helper_id is not null;
  v_recalc boolean;
  v_route_name text;
  v_new_driver numeric;
  v_new_helper numeric;
  v_old_driver_sum numeric;
  v_old_helper_sum numeric;
  v_new_driver_sum numeric;
  v_new_helper_sum numeric;
  v_count int := 0;
begin
  select u.role, e.full_name into v_role, v_name
  from users u left join employees e on e.id = u.employee_id
  where u.id = auth.uid();
  if coalesce(v_role, '') not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang boleh koreksi mobil/driver/kenek.';
  end if;

  if length(v_reason) < 5 then
    raise exception 'Alasan wajib diisi (minimal 5 huruf).';
  end if;
  if p_vehicle_id is null or p_driver_id is null then
    raise exception 'Mobil dan driver wajib diisi.';
  end if;
  if p_helper_id = p_driver_id then
    raise exception 'Driver dan Kenek tidak boleh orang yang sama.';
  end if;
  if not exists (select 1 from vehicles where id = p_vehicle_id) then
    raise exception 'Mobil tidak ditemukan.';
  end if;
  if not exists (select 1 from employees where id = p_driver_id)
     or (p_helper_id is not null and not exists (select 1 from employees where id = p_helper_id)) then
    raise exception 'Karyawan tidak ditemukan.';
  end if;

  select * into v_plan from logistics_delivery_plans where id = p_plan_id for update;
  if not found then raise exception 'Rencana pengiriman tidak ditemukan.'; end if;
  if v_plan.status = 'cancelled' then raise exception 'Rencana sudah dibatalkan.'; end if;

  if v_plan.vehicle_id = p_vehicle_id and v_plan.driver_id = p_driver_id
     and v_plan.helper_id is not distinct from p_helper_id then
    raise exception 'Tidak ada yang diubah.';
  end if;

  if v_plan.vehicle_id <> p_vehicle_id then
    if exists (
      select 1 from logistics_delivery_plans o
      where o.id <> p_plan_id and o.vehicle_id = p_vehicle_id and o.plan_date = v_plan.plan_date
        and o.status in ('departed', 'closing')
    ) then
      raise exception 'Mobil ini sedang dipakai trip lain yang masih berjalan di tanggal yang sama.';
    end if;
    -- Trip yang belum selesai: complete_logistics_delivery nanti butuh tarif mobil baru x rute.
    if not exists (select 1 from driver_rate_configs where vehicle_id = p_vehicle_id and route_id = v_plan.route_id) then
      raise exception 'Tarif mobil baru untuk rute % belum disetup (Penggajian > Tarif & Mobil Driver).',
        (select name from delivery_routes where id = v_plan.route_id);
    end if;
  end if;

  v_recalc := v_plan.vehicle_id <> p_vehicle_id or (v_plan.helper_id is not null) <> v_has_helper;

  -- Semua baris upah plan ini: trip utama + tiap belanja yang sudah selesai.
  for v_trip in
    select t.* from delivery_trips t
    where t.id = v_plan.delivery_trip_id
       or t.id in (select st.delivery_trip_id from logistics_plan_supplier_tasks st
                   where st.plan_id = p_plan_id and st.delivery_trip_id is not null)
    for update
  loop
    if v_trip.payment_status = 'paid' then
      raise exception 'Upah driver trip ini sudah dibayar. Koreksi lewat Penggajian Driver.';
    end if;
    if coalesce(v_trip.helper_payment_status, 'unpaid') = 'paid' then
      raise exception 'Upah kenek trip ini sudah dibayar. Koreksi lewat Penggajian Driver.';
    end if;

    if v_recalc then
      select * into v_rate from driver_rate_configs
      where vehicle_id = p_vehicle_id and route_id = v_trip.route_id
      limit 1;
      if not found then
        select name into v_route_name from delivery_routes where id = v_trip.route_id;
        raise exception 'Tarif mobil baru untuk rute % belum disetup (Penggajian > Tarif & Mobil Driver).', v_route_name;
      end if;
      v_new_driver := case when v_has_helper then v_rate.driver_rate_with_helper else v_rate.driver_rate_without_helper end;
      v_new_helper := case when v_has_helper then v_rate.helper_rate else 0 end;
    else
      v_new_driver := v_trip.driver_earning;
      v_new_helper := v_trip.helper_earning;
    end if;

    update delivery_trips set
      driver_id = p_driver_id, helper_id = p_helper_id, vehicle_id = p_vehicle_id,
      has_helper = v_has_helper, driver_earning = v_new_driver, helper_earning = v_new_helper
    where id = v_trip.id;

    v_count := v_count + 1;
    v_old_driver_sum := coalesce(v_old_driver_sum, 0) + v_trip.driver_earning;
    v_old_helper_sum := coalesce(v_old_helper_sum, 0) + v_trip.helper_earning;
    v_new_driver_sum := coalesce(v_new_driver_sum, 0) + v_new_driver;
    v_new_helper_sum := coalesce(v_new_helper_sum, 0) + v_new_helper;
  end loop;

  update logistics_delivery_plans set
    vehicle_id = p_vehicle_id, driver_id = p_driver_id, helper_id = p_helper_id
  where id = p_plan_id;

  insert into logistics_crew_corrections (
    plan_id, old_vehicle_id, new_vehicle_id, old_driver_id, new_driver_id, old_helper_id, new_helper_id,
    old_driver_earning, new_driver_earning, old_helper_earning, new_helper_earning, trips_updated,
    reason, corrected_by, corrected_by_name
  ) values (
    p_plan_id, v_plan.vehicle_id, p_vehicle_id, v_plan.driver_id, p_driver_id, v_plan.helper_id, p_helper_id,
    v_old_driver_sum, v_new_driver_sum, v_old_helper_sum, v_new_helper_sum, v_count,
    v_reason, auth.uid(), v_name
  );

  return query select v_old_driver_sum, v_new_driver_sum, v_old_helper_sum, v_new_helper_sum, v_count;
end;
$$;

revoke all on function public.office_change_plan_crew(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.office_change_plan_crew(uuid, uuid, uuid, uuid, text) to authenticated;
