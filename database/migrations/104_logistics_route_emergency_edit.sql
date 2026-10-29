-- 104: Edit Darurat Rute di Laporan Pengiriman.
--
-- Kasus: trip berangkat dengan rute A di rencana, kenyataannya jalan ke rute B (tidak sesuai
-- jalur). Untuk administrasi, rute rencana harus dikoreksi DAN upah ritase ikut tarif rute yang
-- benar (driver_rate_configs: mobil x rute, ada/tidak kenek).
--
-- - Hanya Owner/HR/Finance.
-- - Alasan wajib, tiap koreksi tercatat di logistics_route_corrections (rute & upah lama/baru).
-- - Kalau trip sudah selesai (delivery_trip_id terisi), baris delivery_trips ikut diubah: rute +
--   driver_earning + helper_earning. Ditolak kalau upah driver/kenek trip itu SUDAH dibayar --
--   uangnya sudah keluar, koreksi harus lewat Penggajian Driver.
-- - Kalau trip belum selesai, cukup rute rencananya; complete_logistics_delivery nanti otomatis
--   menghitung upah dari rute yang baru.

create table if not exists public.logistics_route_corrections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.logistics_delivery_plans(id) on delete cascade,
  delivery_trip_id uuid references public.delivery_trips(id) on delete set null,
  old_route_id uuid references public.delivery_routes(id),
  new_route_id uuid not null references public.delivery_routes(id),
  old_driver_earning numeric(12,2),
  new_driver_earning numeric(12,2),
  old_helper_earning numeric(12,2),
  new_helper_earning numeric(12,2),
  reason text not null,
  corrected_by uuid default auth.uid(),
  corrected_by_name text,
  corrected_at timestamptz not null default now()
);

create index if not exists logistics_route_corrections_plan_idx on public.logistics_route_corrections(plan_id);

alter table public.logistics_route_corrections enable row level security;

-- Baca: sama seperti Laporan Pengiriman (Owner/HR/Finance/Kepala Gudang). Tulis hanya lewat RPC.
drop policy if exists logistics_route_corrections_select on public.logistics_route_corrections;
create policy logistics_route_corrections_select on public.logistics_route_corrections
  for select to authenticated using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('owner', 'hr', 'finance'))
    or exists (
      select 1 from public.users u
      join public.employees e on e.id = u.employee_id
      join public.positions p on p.id = e.position_id
      where u.id = auth.uid() and p.name = 'Kepala Gudang'
    )
  );

create or replace function public.emergency_change_plan_route(
  p_plan_id uuid,
  p_new_route_id uuid,
  p_reason text
) returns table (old_driver_earning numeric, new_driver_earning numeric, old_helper_earning numeric, new_helper_earning numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_plan logistics_delivery_plans%rowtype;
  v_trip delivery_trips%rowtype;
  v_rate driver_rate_configs%rowtype;
  v_new_driver numeric;
  v_new_helper numeric;
begin
  select u.role, e.full_name into v_role, v_name
  from users u left join employees e on e.id = u.employee_id
  where u.id = auth.uid();
  if coalesce(v_role, '') not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang boleh edit darurat rute.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Alasan wajib diisi (minimal 5 huruf).';
  end if;

  select * into v_plan from logistics_delivery_plans where id = p_plan_id for update;
  if not found then raise exception 'Rencana pengiriman tidak ditemukan.'; end if;
  if v_plan.status = 'cancelled' then raise exception 'Rencana sudah dibatalkan.'; end if;
  if v_plan.route_id = p_new_route_id then raise exception 'Rute baru sama dengan rute sekarang.'; end if;
  if not exists (select 1 from delivery_routes where id = p_new_route_id) then
    raise exception 'Rute tidak ditemukan.';
  end if;

  select * into v_rate from driver_rate_configs
  where vehicle_id = v_plan.vehicle_id and route_id = p_new_route_id
  limit 1;
  if not found then
    raise exception 'Tarif untuk mobil ini di rute tersebut belum disetup (Penggajian > Tarif & Mobil Driver).';
  end if;

  if v_plan.delivery_trip_id is not null then
    select * into v_trip from delivery_trips where id = v_plan.delivery_trip_id for update;
  end if;

  if v_trip.id is not null then
    if v_trip.payment_status = 'paid' then
      raise exception 'Upah driver trip ini sudah dibayar. Koreksi lewat Penggajian Driver.';
    end if;
    if coalesce(v_trip.helper_payment_status, 'unpaid') = 'paid' then
      raise exception 'Upah kenek trip ini sudah dibayar. Koreksi lewat Penggajian Driver.';
    end if;

    v_new_driver := case when v_trip.has_helper then v_rate.driver_rate_with_helper else v_rate.driver_rate_without_helper end;
    v_new_helper := case when v_trip.has_helper then v_rate.helper_rate else 0 end;

    update delivery_trips
    set route_id = p_new_route_id, driver_earning = v_new_driver, helper_earning = v_new_helper
    where id = v_trip.id;
  end if;

  update logistics_delivery_plans set route_id = p_new_route_id where id = p_plan_id;

  insert into logistics_route_corrections (
    plan_id, delivery_trip_id, old_route_id, new_route_id,
    old_driver_earning, new_driver_earning, old_helper_earning, new_helper_earning,
    reason, corrected_by, corrected_by_name
  ) values (
    p_plan_id, v_trip.id, v_plan.route_id, p_new_route_id,
    v_trip.driver_earning, v_new_driver, v_trip.helper_earning, v_new_helper,
    trim(p_reason), auth.uid(), v_name
  );

  return query select v_trip.driver_earning, v_new_driver, v_trip.helper_earning, v_new_helper;
end;
$$;

revoke all on function public.emergency_change_plan_route(uuid, uuid, text) from public, anon;
grant execute on function public.emergency_change_plan_route(uuid, uuid, text) to authenticated;
