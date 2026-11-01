-- 114: Absen QR / HP wajib berada dalam radius cabang (GPS) -- dicek di database.
--
-- Masalah: QR absen statis (link /absen-qr/<token> per cabang). Foto QR / link-nya bisa
-- disebar lalu di-scan dari galeri di rumah, dan mode QR sama sekali tidak mengecek lokasi.
--
-- Solusi: AbsenSekarang.tsx sekarang meminta GPS juga di mode QR, dicocokkan ke koordinat
-- cabang TEMPAT QR (check_in_branch_id / check_out_branch_id -- bisa cabang perbantuan).
-- Trigger ini mengulang pengecekan yang sama di database supaya tidak bisa dilewati lewat API
-- langsung / aplikasi versi lama. Aturan:
--   - Hanya baris absen milik user yang login sendiri (sama seperti migr 113), source qr/mobile.
--   - Cabang yang belum diisi latitude/longitude di menu Cabang: tidak dicek (jalan seperti
--     sebelumnya) -- HR bisa mengaktifkan per cabang.
--   - Koordinat wajib ada dan jarak <= checkin_radius_meters (+5 m toleransi pembulatan).
-- Batas wajar absen berbasis web: koordinat berasal dari HP, jadi aplikasi "fake GPS" tetap bisa
-- memalsukan lokasi -- tapi itu sudah usaha sengaja, bukan sekadar menyebar foto QR.

create or replace function public.distance_meters(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
 returns numeric
 language sql
 immutable
as $function$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
  ))::numeric;
$function$;

create or replace function public.enforce_checkin_radius()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_branch_id uuid;
  v_name      text;
  v_lat       numeric;
  v_lng       numeric;
  v_radius    int;
  v_dist      numeric;
  v_is_out    boolean;
  v_p_lat     numeric;
  v_p_lng     numeric;
begin
  if auth.uid() is null
     or NEW.source is distinct from 'qr' and NEW.source is distinct from 'mobile'
     or NEW.employee_id is distinct from get_my_employee_id() then
    return NEW;
  end if;

  if TG_OP = 'INSERT' and NEW.check_in is not null then
    v_is_out := false;
  elsif TG_OP = 'UPDATE' and NEW.check_out is not null and NEW.check_out is distinct from OLD.check_out then
    v_is_out := true;
  else
    return NEW;
  end if;

  v_branch_id := case when v_is_out then NEW.check_out_branch_id else NEW.check_in_branch_id end;
  if v_branch_id is null then
    select branch_id into v_branch_id from employees where id = NEW.employee_id;
  end if;

  select name, latitude, longitude, coalesce(checkin_radius_meters, 150)
  into v_name, v_lat, v_lng, v_radius
  from branches where id = v_branch_id;

  if v_lat is null or v_lng is null then
    return NEW;
  end if;

  v_p_lat := case when v_is_out then NEW.check_out_lat else NEW.check_in_lat end;
  v_p_lng := case when v_is_out then NEW.check_out_lng else NEW.check_in_lng end;
  if v_p_lat is null or v_p_lng is null then
    raise exception 'Lokasi GPS wajib untuk absen di %. Aktifkan lokasi HP, muat ulang halaman, lalu coba lagi.', v_name
      using errcode = 'P0001';
  end if;

  v_dist := distance_meters(v_p_lat, v_p_lng, v_lat, v_lng);
  if v_dist > v_radius + 5 then
    raise exception 'Anda berada %m dari % — maksimal %m untuk bisa absen.', round(v_dist), v_name, v_radius
      using errcode = 'P0001';
  end if;

  if v_is_out then
    NEW.check_out_distance_m := round(v_dist);
  else
    NEW.check_in_distance_m := round(v_dist);
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_01_enforce_checkin_radius on public.attendances;
create trigger trg_01_enforce_checkin_radius
  before insert or update on public.attendances
  for each row execute function public.enforce_checkin_radius();
