-- 115: Koordinat cabang untuk absen QR wajib GPS (migr 114), dari pin Google Maps Owner.
-- Dicek ke link maps.app.goo.gl masing-masing: selisih 2-25 m dari pin tempatnya.
-- Gudang & Back Office: satu lokasi dengan Toko Pusat ("Hammielion Gudang 1"), jadi koordinatnya sama.
-- Radius 50 m (permintaan Owner). Logistik belum diisi (absen QR di sana tetap tanpa GPS).
-- WAJIB diterapkan SETELAH aplikasi versi absen-QR-pakai-GPS ter-deploy -- versi lama tidak
-- mengirim GPS, jadi semua absen QR di cabang ini akan ditolak trigger enforce_checkin_radius.

update public.branches set latitude = -7.350564720030627, longitude = 108.10865608125447, checkin_radius_meters = 50
  where name in ('Toko Pusat', 'Gudang', 'Back Office');
update public.branches set latitude = -7.35148882045046,  longitude = 108.11040975611628, checkin_radius_meters = 50
  where name = 'Toko Depan';
update public.branches set latitude = -7.330201639984503, longitude = 108.2066281965964,  checkin_radius_meters = 50
  where name = 'Markas Petshop';
update public.branches set latitude = -7.348385400436556, longitude = 108.22451225311764, checkin_radius_meters = 50
  where name = 'Raja Petshop';
