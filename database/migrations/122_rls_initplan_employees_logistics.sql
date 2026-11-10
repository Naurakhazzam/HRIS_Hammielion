-- 122: Halaman Surat Jalan "Gagal memuat: canceling statement due to statement timeout".
--
-- Penyebab: query surat jalan meng-embed plan -> driver (employees). RLS employees, delivery_trips,
-- logistics_delivery_plans & logistics_plan_stores memanggil get_my_employee_id()/get_my_role()/
-- is_kepala_gudang_or_owner() TANPA dibungkus (SELECT ...), sehingga fungsi itu dieksekusi ulang
-- untuk SETIAP baris (bahkan setiap baris delivery_trips di dalam EXISTS per baris employees).
-- ~135 surat jalan/bulan -> ~2 detik; bertambah linear seiring data -> tembus batas 8s.
--
-- Perbaikan: bungkus semua panggilan fungsi dengan (SELECT fn()) supaya Postgres menghitungnya
-- sekali per query (InitPlan). Logika akses TIDAK berubah.

-- employees -----------------------------------------------------------------------------------
DROP POLICY IF EXISTS employees_read_trip_partner ON public.employees;
CREATE POLICY employees_read_trip_partner ON public.employees FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM delivery_trips t
    WHERE (t.driver_id = (SELECT get_my_employee_id()) AND t.helper_id = employees.id)
       OR (t.helper_id = (SELECT get_my_employee_id()) AND t.driver_id = employees.id)
  )
);

DROP POLICY IF EXISTS employees_read_self ON public.employees;
CREATE POLICY employees_read_self ON public.employees FOR SELECT USING (
  (SELECT get_my_role()) = 'employee'::user_role AND id = (SELECT get_my_employee_id())
);

DROP POLICY IF EXISTS employees_read_supervisor ON public.employees;
CREATE POLICY employees_read_supervisor ON public.employees FOR SELECT USING (
  (SELECT get_my_role()) = 'supervisor'::user_role AND branch_id = (SELECT get_my_branch_id())
);

DROP POLICY IF EXISTS employees_read_owner_hr_finance ON public.employees;
CREATE POLICY employees_read_owner_hr_finance ON public.employees FOR SELECT USING (
  (SELECT get_my_role()) = ANY (ARRAY['owner'::user_role, 'hr'::user_role, 'finance'::user_role])
);

DROP POLICY IF EXISTS employees_read_kepala_gudang ON public.employees;
CREATE POLICY employees_read_kepala_gudang ON public.employees FOR SELECT USING (
  (SELECT is_kepala_gudang_or_owner())
);

DROP POLICY IF EXISTS employees_read_grooming_participants ON public.employees;
CREATE POLICY employees_read_grooming_participants ON public.employees FOR SELECT USING (
  (SELECT is_store_branch_staff() OR is_logistics_overseer()) AND (
       EXISTS (SELECT 1 FROM grooming_order_cats c
               WHERE c.groomer_id = employees.id OR c.finished_by = employees.id)
    OR EXISTS (SELECT 1 FROM grooming_orders o
               WHERE employees.id IN (o.created_by, o.pickup_assignee, o.delivery_assignee,
                                      o.arrived_by, o.handover_by, o.cancelled_by))
    OR EXISTS (SELECT 1 FROM grooming_groomer_changes g
               WHERE employees.id IN (g.old_groomer, g.new_groomer, g.changed_by))
    OR EXISTS (SELECT 1 FROM grooming_price_changes p WHERE p.changed_by = employees.id)
    OR EXISTS (SELECT 1 FROM grooming_assignment_changes a
               WHERE employees.id IN (a.old_emp, a.new_emp, a.changed_by))
    OR EXISTS (SELECT 1 FROM grooming_ongkir_changes k WHERE k.changed_by = employees.id)
  )
);

DROP POLICY IF EXISTS employees_write_owner_hr ON public.employees;
CREATE POLICY employees_write_owner_hr ON public.employees FOR ALL USING (
  (SELECT get_my_role()) = ANY (ARRAY['owner'::user_role, 'hr'::user_role])
);

-- Jalan pintas: Kepala Gudang/owner/hr/finance sudah boleh lihat semua karyawan lewat policy lain,
-- jadi lewati can_see_logistics_participant(id) (mahal, dieksekusi per baris) untuk mereka.
-- Hasil akses (gabungan OR semua policy) tidak berubah.
DROP POLICY IF EXISTS employees_read_logistics_participants ON public.employees;
CREATE POLICY employees_read_logistics_participants ON public.employees FOR SELECT USING (
  (SELECT is_kepala_gudang_or_owner()
       OR COALESCE(get_my_role() = ANY (ARRAY['owner'::user_role, 'hr'::user_role, 'finance'::user_role]), false))
  OR (
    (SELECT (is_toko_pusat_or_owner() OR is_store_branch_staff() OR is_kepala_gudang_or_owner()
             OR is_driver_or_kenek() OR (get_my_role() = ANY (ARRAY['hr'::user_role, 'finance'::user_role]))))
    AND can_see_logistics_participant(id)
  )
);

-- delivery_trips ------------------------------------------------------------------------------
DROP POLICY IF EXISTS trips_read_own_driver_kenek ON public.delivery_trips;
CREATE POLICY trips_read_own_driver_kenek ON public.delivery_trips FOR SELECT USING (
  driver_id = (SELECT get_my_employee_id()) OR helper_id = (SELECT get_my_employee_id())
);

DROP POLICY IF EXISTS trips_read_owner_hr_finance ON public.delivery_trips;
CREATE POLICY trips_read_owner_hr_finance ON public.delivery_trips FOR SELECT USING (
  (SELECT get_my_role()) = ANY (ARRAY['owner'::user_role, 'hr'::user_role, 'finance'::user_role])
);

-- logistics_delivery_plans / logistics_plan_stores --------------------------------------------
DROP POLICY IF EXISTS logistics_plans_read ON public.logistics_delivery_plans;
CREATE POLICY logistics_plans_read ON public.logistics_delivery_plans FOR SELECT USING (
  driver_id = (SELECT get_my_employee_id())
  OR helper_id = (SELECT get_my_employee_id())
  OR (SELECT is_kepala_gudang_or_owner())
  OR (SELECT get_my_role()) = ANY (ARRAY['hr'::user_role, 'finance'::user_role])
);

DROP POLICY IF EXISTS logistics_plan_stores_read ON public.logistics_plan_stores;
CREATE POLICY logistics_plan_stores_read ON public.logistics_plan_stores FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM logistics_delivery_plans p
    WHERE p.id = logistics_plan_stores.plan_id AND (
         p.driver_id = (SELECT get_my_employee_id())
      OR p.helper_id = (SELECT get_my_employee_id())
      OR (SELECT is_kepala_gudang_or_owner())
      OR (SELECT get_my_role()) = ANY (ARRAY['hr'::user_role, 'finance'::user_role])
    )
  )
);
