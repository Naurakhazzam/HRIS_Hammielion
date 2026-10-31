-- 106: Susulan / Hapus Belanja Supplier oleh kantor di Laporan Pengiriman.
--
-- Kasus: trip sudah Selesai, tapi belanja supplier yang benar-benar dikerjakan driver tidak
-- tercatat (tidak ada di rencana / lupa dilaporkan) -> upah ritase belanjanya hilang. Trip
-- Selesai sudah hilang dari HP driver dan Rencana tidak bisa diubah lagi, jadi tidak ada jalan
-- keluar selain Input Trip manual di Gaji Driver (tidak nyambung ke laporan, tanpa jejak).
-- Sebaliknya, belanja yang salah dicatat juga tidak bisa dihapus beserta upahnya.
--
-- - Hanya Owner/HR/Finance, alasan wajib (min. 5 huruf). Foto nota TIDAK wajib untuk susulan.
-- - Susulan hanya untuk trip berstatus 'completed' (trip yang masih jalan: tambah lewat Rencana,
--   driver memprosesnya seperti biasa). Upah dari tarif mobil x rute Belanja, tanggal = tanggal
--   trip (bukan hari ini) supaya masuk minggu gajian yang benar.
-- - Hapus: tugas + baris delivery_trips-nya. Ditolak kalau upah driver/kenek sudah dibayar.
-- - Tiap tambah/hapus tercatat di logistics_supplier_task_corrections.
-- - complete_supplier_task (oleh driver) juga dibetulkan: trip_date = tanggal trip, bukan now().

alter table public.logistics_plan_supplier_tasks
  add column if not exists office_reason text,
  add column if not exists office_by_name text;

-- Susulan kantor boleh tanpa foto, asal ada alasan.
alter table public.logistics_plan_supplier_tasks drop constraint if exists supplier_task_requires_proof_when_done;
alter table public.logistics_plan_supplier_tasks add constraint supplier_task_requires_proof_when_done
  check (status <> 'done' or proof_photo_url is not null or office_reason is not null);

create table if not exists public.logistics_supplier_task_corrections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.logistics_delivery_plans(id) on delete cascade,
  action text not null check (action in ('tambah', 'hapus')),
  route_id uuid references public.delivery_routes(id),
  driver_earning numeric(12,2),
  helper_earning numeric(12,2),
  reason text not null,
  corrected_by uuid default auth.uid(),
  corrected_by_name text,
  corrected_at timestamptz not null default now()
);

create index if not exists logistics_supplier_task_corrections_plan_idx on public.logistics_supplier_task_corrections(plan_id);

alter table public.logistics_supplier_task_corrections enable row level security;

-- Baca: sama seperti Laporan Pengiriman (Owner/HR/Finance/Kepala Gudang). Tulis hanya lewat RPC.
drop policy if exists logistics_supplier_task_corrections_select on public.logistics_supplier_task_corrections;
create policy logistics_supplier_task_corrections_select on public.logistics_supplier_task_corrections
  for select to authenticated using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('owner', 'hr', 'finance'))
    or exists (
      select 1 from public.users u
      join public.employees e on e.id = u.employee_id
      join public.positions p on p.id = e.position_id
      where u.id = auth.uid() and p.name = 'Kepala Gudang'
    )
  );

create or replace function public.office_add_supplier_task(
  p_plan_id uuid,
  p_route_id uuid,
  p_reason text
) returns table (driver_earning numeric, helper_earning numeric, week_already_paid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_emp uuid;
  v_name text;
  v_plan logistics_delivery_plans%rowtype;
  v_rate driver_rate_configs%rowtype;
  v_has_helper boolean;
  v_driver numeric;
  v_helper numeric;
  v_week_start date;
  v_trip_id uuid;
  v_paid boolean;
begin
  select u.role, u.employee_id, e.full_name into v_role, v_emp, v_name
  from users u left join employees e on e.id = u.employee_id
  where u.id = auth.uid();
  if coalesce(v_role, '') not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang boleh menambah susulan belanja.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Alasan wajib diisi (minimal 5 huruf).';
  end if;

  select * into v_plan from logistics_delivery_plans where id = p_plan_id for update;
  if not found then raise exception 'Rencana pengiriman tidak ditemukan.'; end if;
  if v_plan.status != 'completed' then
    raise exception 'Susulan hanya untuk trip yang sudah Selesai. Trip yang masih berjalan: tambah tugas belanja lewat Rencana.';
  end if;

  if not exists (select 1 from delivery_routes where id = p_route_id and name ilike 'Belanja%') then
    raise exception 'Rute belanja tidak ditemukan.';
  end if;

  select * into v_rate from driver_rate_configs
  where vehicle_id = v_plan.vehicle_id and route_id = p_route_id
  limit 1;
  if not found then
    raise exception 'Tarif untuk mobil ini di rute belanja tersebut belum disetup (Penggajian > Tarif & Mobil Driver).';
  end if;

  v_has_helper := v_plan.helper_id is not null;
  v_driver := case when v_has_helper then v_rate.driver_rate_with_helper else v_rate.driver_rate_without_helper end;
  v_helper := case when v_has_helper then v_rate.helper_rate else 0 end;
  -- Minggu gajian driver mulai Jumat (sama dengan complete_logistics_delivery).
  v_week_start := v_plan.plan_date - ((extract(dow from v_plan.plan_date)::int - 5 + 7) % 7);

  select exists (
    select 1 from delivery_trips t
    where t.week_start_date = v_week_start
      and ((t.driver_id = v_plan.driver_id and t.payment_status = 'paid')
        or (v_has_helper and t.helper_id = v_plan.helper_id and t.helper_payment_status = 'paid'))
  ) into v_paid;

  insert into delivery_trips (
    driver_id, helper_id, vehicle_id, route_id, trip_date, has_helper,
    driver_earning, helper_earning, week_start_date, payment_status, created_by
  ) values (
    v_plan.driver_id, case when v_has_helper then v_plan.helper_id else null end,
    v_plan.vehicle_id, p_route_id, v_plan.plan_date, v_has_helper,
    v_driver, v_helper, v_week_start, 'unpaid', v_emp
  ) returning id into v_trip_id;

  insert into logistics_plan_supplier_tasks (
    plan_id, route_id, status, created_by, resolved_by, resolved_at, delivery_trip_id, office_reason, office_by_name
  ) values (
    p_plan_id, p_route_id, 'done', v_emp, v_emp, now(), v_trip_id, trim(p_reason), v_name
  );

  insert into logistics_supplier_task_corrections (plan_id, action, route_id, driver_earning, helper_earning, reason, corrected_by_name)
  values (p_plan_id, 'tambah', p_route_id, v_driver, v_helper, trim(p_reason), v_name);

  return query select v_driver, v_helper, v_paid;
end;
$$;

create or replace function public.office_delete_supplier_task(
  p_task_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text;
  v_task logistics_plan_supplier_tasks%rowtype;
  v_trip delivery_trips%rowtype;
begin
  select u.role, e.full_name into v_role, v_name
  from users u left join employees e on e.id = u.employee_id
  where u.id = auth.uid();
  if coalesce(v_role, '') not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang boleh menghapus belanja.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Alasan wajib diisi (minimal 5 huruf).';
  end if;

  select * into v_task from logistics_plan_supplier_tasks where id = p_task_id for update;
  if not found then raise exception 'Tugas belanja tidak ditemukan.'; end if;

  if v_task.delivery_trip_id is not null then
    select * into v_trip from delivery_trips where id = v_task.delivery_trip_id for update;
    if v_trip.payment_status = 'paid' then
      raise exception 'Upah driver belanja ini sudah dibayar. Koreksi lewat Penggajian Driver.';
    end if;
    if coalesce(v_trip.helper_payment_status, 'unpaid') = 'paid' then
      raise exception 'Upah kenek belanja ini sudah dibayar. Koreksi lewat Penggajian Driver.';
    end if;
  end if;

  delete from logistics_plan_supplier_tasks where id = p_task_id;
  if v_trip.id is not null then
    delete from delivery_trips where id = v_trip.id;
  end if;

  insert into logistics_supplier_task_corrections (plan_id, action, route_id, driver_earning, helper_earning, reason, corrected_by_name)
  values (v_task.plan_id, 'hapus', v_task.route_id, v_trip.driver_earning, v_trip.helper_earning, trim(p_reason), v_name);
end;
$$;

revoke all on function public.office_add_supplier_task(uuid, uuid, text) from public, anon;
grant execute on function public.office_add_supplier_task(uuid, uuid, text) to authenticated;
revoke all on function public.office_delete_supplier_task(uuid, text) from public, anon;
grant execute on function public.office_delete_supplier_task(uuid, text) to authenticated;

-- Driver menyelesaikan belanja: upah ikut tanggal trip (dulu now() -- belanja yang diproses
-- lewat tengah malam / trip tanggal kemarin bisa masuk minggu gajian yang salah).
create or replace function public.complete_supplier_task(p_task_id uuid, p_proof_photo_url text)
 returns table(delivery_trip_id uuid, driver_earning numeric, helper_earning numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task logistics_plan_supplier_tasks%rowtype;
  v_plan logistics_delivery_plans%rowtype;
  v_rate driver_rate_configs%rowtype;
  v_has_helper boolean;
  v_driver_earning numeric;
  v_helper_earning numeric;
  v_trip_date date;
  v_dow int;
  v_diff int;
  v_week_start date;
  v_trip_id uuid;
  v_my_employee_id uuid := get_my_employee_id();
begin
  select * into v_task from logistics_plan_supplier_tasks where id = p_task_id for update;
  if not found then raise exception 'Tugas belanja tidak ditemukan.'; end if;
  if v_task.status != 'pending' then
    raise exception 'Tugas ini sudah lebih dulu diproses.';
  end if;
  if p_proof_photo_url is null or length(trim(p_proof_photo_url)) = 0 then
    raise exception 'Foto surat jalan/nota wajib diisi.';
  end if;

  select * into v_plan from logistics_delivery_plans where id = v_task.plan_id;
  if not found then raise exception 'Rencana pengiriman tidak ditemukan.'; end if;

  if v_my_employee_id is null or (v_plan.driver_id != v_my_employee_id and v_plan.helper_id is distinct from v_my_employee_id) then
    raise exception 'Anda bukan driver/kenek yang ditugaskan pada rencana ini.';
  end if;

  select * into v_rate from driver_rate_configs
  where vehicle_id = v_plan.vehicle_id and route_id = v_task.route_id;
  if not found then
    raise exception 'Tarif untuk kombinasi Mobil dan Rute Belanja ini belum disetup.';
  end if;

  v_has_helper := v_plan.helper_id is not null;
  v_driver_earning := case when v_has_helper then v_rate.driver_rate_with_helper else v_rate.driver_rate_without_helper end;
  v_helper_earning := case when v_has_helper then v_rate.helper_rate else 0 end;

  v_trip_date := v_plan.plan_date;
  v_dow := extract(dow from v_trip_date)::int;
  v_diff := -(((v_dow - 5 + 7) % 7));
  v_week_start := v_trip_date + v_diff;

  insert into delivery_trips (
    driver_id, helper_id, vehicle_id, route_id, trip_date, has_helper,
    driver_earning, helper_earning, week_start_date, payment_status, created_by
  ) values (
    v_plan.driver_id, case when v_has_helper then v_plan.helper_id else null end,
    v_plan.vehicle_id, v_task.route_id, v_trip_date, v_has_helper,
    v_driver_earning, v_helper_earning, v_week_start, 'unpaid', v_plan.created_by
  ) returning id into v_trip_id;

  update logistics_plan_supplier_tasks set
    status = 'done',
    proof_photo_url = p_proof_photo_url,
    resolved_by = v_my_employee_id,
    resolved_at = now(),
    delivery_trip_id = v_trip_id
  where id = p_task_id;

  return query select v_trip_id, v_driver_earning, v_helper_earning;
end;
$function$;
