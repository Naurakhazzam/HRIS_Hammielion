-- 123: Percepat SEMUA RLS policy: bungkus fungsi helper tanpa argumen dengan (SELECT fn()).
--
-- Lanjutan migrasi 122. Ratusan policy memanggil get_my_role()/get_my_employee_id()/
-- get_my_branch_id()/is_*() langsung, sehingga Postgres mengeksekusinya untuk SETIAP baris
-- (tiap panggilan = 1 query ke tabel users/employees). Makin banyak data, makin lambat, sampai
-- kena "canceling statement due to statement timeout" (batas 8s role authenticated).
-- Dengan (SELECT fn()) Postgres menghitungnya SEKALI per query (InitPlan). Fungsi-fungsi ini
-- STABLE & tanpa argumen, jadi hasilnya identik -> logika akses TIDAK berubah.
--
-- Idempotent: panggilan yang sudah dibungkus "(SELECT fn())" dilewati, aman dijalankan ulang.
-- ATURAN UNTUK POLICY BARU: selalu tulis (SELECT get_my_role()), (SELECT get_my_employee_id()),
-- (SELECT auth.uid()), dst. — jangan panggil langsung.
SET LOCAL lock_timeout = '10s';
DO $$
DECLARE
  r   record;
  re  text := '(?<!SELECT )\m(get_my_role|get_my_employee_id|get_my_branch_id|is_kepala_gudang_or_owner|is_kepala_gudang_owner_or_finance|is_driver_or_kenek|is_toko_pusat_or_owner|is_cashier_report_admin|is_store_branch_staff|is_logistics_overseer|auth\.uid)\(\)';
  nq  text;
  nw  text;
  sql text;
  n   int := 0;
  tbls text;
BEGIN
  -- Kunci semua tabel target sekaligus, urut nama, supaya tidak deadlock dengan traffic aplikasi
  -- (percobaan pertama tanpa ini kena "deadlock detected").
  SELECT string_agg(format('public.%I', tablename), ', ' ORDER BY tablename) INTO tbls
  FROM (SELECT DISTINCT tablename FROM pg_policies WHERE schemaname='public'
        AND (regexp_replace(qual, re, '', 'g') IS DISTINCT FROM qual
          OR regexp_replace(with_check, re, '', 'g') IS DISTINCT FROM with_check)) s;
  IF tbls IS NOT NULL THEN EXECUTE 'LOCK TABLE ' || tbls || ' IN ACCESS EXCLUSIVE MODE'; END IF;

  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies WHERE schemaname = 'public'
  LOOP
    nq := regexp_replace(r.qual, re, '(SELECT \1())', 'g');
    nw := regexp_replace(r.with_check, re, '(SELECT \1())', 'g');
    CONTINUE WHEN nq IS NOT DISTINCT FROM r.qual AND nw IS NOT DISTINCT FROM r.with_check;

    sql := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF nq IS NOT NULL THEN sql := sql || format(' USING (%s)', nq); END IF;
    IF nw IS NOT NULL THEN sql := sql || format(' WITH CHECK (%s)', nw); END IF;
    EXECUTE sql;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS initplan: % policy diperbarui', n;
END $$;
