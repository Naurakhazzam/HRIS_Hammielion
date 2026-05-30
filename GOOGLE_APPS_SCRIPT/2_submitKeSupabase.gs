/**
 * HAMMIELION HRIS — Google Apps Script
 * File 2: Submit data form ke Supabase
 *
 * CARA PAKAI:
 * 1. Masih di project yang sama
 * 2. Buat file baru, copy-paste script ini
 * 3. Isi SUPABASE_URL, SUPABASE_KEY, dan FORM_ID di bagian CONFIG
 * 4. Buat trigger: Klik ikon jam (Triggers) → Add Trigger
 *    - Pilih fungsi: onFormSubmit
 *    - Event source: From form
 *    - Event type: On form submit
 * 5. Selesai! Setiap karyawan submit form, data masuk Supabase otomatis
 */

// ══════════════════════════════════════════════
// ⚙️  KONFIGURASI — ISI BAGIAN INI
// ══════════════════════════════════════════════
const CONFIG = {
  SUPABASE_URL: 'https://rwzerjfzazhpcnfktgax.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3emVyamZ6YXpocGNuZmt0Z2F4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYwODQxNSwiZXhwIjoyMDkzMTg0NDE1fQ.z5auPD8CyVRFaig8fD8P-k4HvPPkEkkIMtEW8fssH2U',
  // Email HR untuk notifikasi jika karyawan tidak ditemukan
  HR_EMAIL: 'darkatar9@gmail.com',
};

// ══════════════════════════════════════════════
// 🔄 FUNGSI UTAMA — Jalan otomatis saat form disubmit
// ══════════════════════════════════════════════
function onFormSubmit(e) {
  try {
    const response  = e.response;
    const answers   = response.getItemResponses();
    const timestamp = response.getTimestamp();

    // Ambil semua jawaban ke object
    const data = {};
    answers.forEach(function(item) {
      data[item.getItem().getTitle()] = item.getResponse();
    });

    Logger.log('Data masuk: ' + JSON.stringify(data));

    // Mapping jawaban ke field database
    const fullName = (data['Nama Lengkap'] || '').trim();

    if (!fullName) {
      kirimEmailError('Submission tanpa nama lengkap', JSON.stringify(data));
      return;
    }

    // Cari karyawan berdasarkan nama (case-insensitive)
    const employee = cariKaryawan(fullName);

    if (!employee) {
      // Karyawan tidak ditemukan di sistem
      kirimEmailTidakDitemukan(fullName, data);
      return;
    }

    // Siapkan data update
    const updateData = buildUpdateData(data, timestamp);

    // Update ke Supabase
    const success = updateKaryawan(employee.id, updateData);

    if (success) {
      Logger.log('✅ Data ' + fullName + ' berhasil diupdate di Supabase');
      kirimEmailSukses(fullName, employee.employee_code);
    } else {
      kirimEmailError('Gagal update data ' + fullName, JSON.stringify(updateData));
    }

  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
    kirimEmailError('Error saat proses form', err.message);
  }
}

// ══════════════════════════════════════════════
// 🔍 Cari karyawan di Supabase berdasarkan nama
// ══════════════════════════════════════════════
function cariKaryawan(fullName) {
  const url = CONFIG.SUPABASE_URL + '/rest/v1/employees' +
    '?select=id,employee_code,full_name' +
    '&full_name=ilike.' + encodeURIComponent('*' + fullName + '*') +
    '&limit=1';

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: getHeaders(),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    Logger.log('Error cari karyawan: ' + body);
    return null;
  }

  const results = JSON.parse(body);
  if (!results || results.length === 0) {
    Logger.log('Karyawan tidak ditemukan: ' + fullName);
    return null;
  }

  // Cari yang namanya paling mirip (exact match dulu)
  const exactMatch = results.find(function(emp) {
    return emp.full_name.toLowerCase() === fullName.toLowerCase();
  });

  return exactMatch || results[0];
}

// ══════════════════════════════════════════════
// 🔨 Bangun object data update dari jawaban form
// ══════════════════════════════════════════════
function buildUpdateData(data, timestamp) {
  const update = {};

  // NIK
  if (data['NIK (Nomor KTP)']) {
    update.nik = data['NIK (Nomor KTP)'].trim();
  }

  // Tempat & Tanggal Lahir
  if (data['Tempat Lahir']) {
    update.birth_place = data['Tempat Lahir'].trim();
  }

  if (data['Tanggal Lahir']) {
    // Format dari Google Form: Date object atau string
    const tgl = data['Tanggal Lahir'];
    if (tgl instanceof Date) {
      update.birth_date = Utilities.formatDate(tgl, 'Asia/Jakarta', 'yyyy-MM-dd');
    } else if (typeof tgl === 'string' && tgl.length > 0) {
      update.birth_date = tgl;
    }
  }

  // Jenis Kelamin
  if (data['Jenis Kelamin']) {
    update.gender = data['Jenis Kelamin'] === 'Laki-laki' ? 'male' : 'female';
  }

  // Agama
  if (data['Agama']) {
    update.religion = data['Agama'];
  }

  // Status Pernikahan
  const maritalMap = {
    'Belum Menikah': 'single',
    'Menikah':       'married',
    'Cerai':         'divorced',
    'Janda/Duda':    'widowed'
  };
  if (data['Status Pernikahan'] && maritalMap[data['Status Pernikahan']]) {
    update.marital_status = maritalMap[data['Status Pernikahan']];
  }

  // Tanggungan
  if (data['Jumlah Tanggungan']) {
    const dep = parseInt(data['Jumlah Tanggungan']);
    if (!isNaN(dep)) update.dependants = dep;
  }

  // Pendidikan
  if (data['Pendidikan Terakhir']) {
    update.education = data['Pendidikan Terakhir'];
  }

  // Nomor HP
  if (data['Nomor HP Aktif']) {
    update.phone = data['Nomor HP Aktif'].trim();
  }

  // Alamat
  if (data['Alamat Domisili']) {
    update.address = data['Alamat Domisili'].trim();
  }

  // Rekening Bank
  if (data['Nama Bank']) {
    update.bank_name = data['Nama Bank'].trim();
  }
  if (data['Nomor Rekening']) {
    update.bank_account_number = data['Nomor Rekening'].trim();
  }
  if (data['Nama Pemilik Rekening']) {
    update.bank_account_name = data['Nama Pemilik Rekening'].trim();
  }

  // Kontak Darurat
  if (data['Nama Kontak Darurat']) {
    update.emergency_contact_name = data['Nama Kontak Darurat'].trim();
  }
  if (data['Nomor Telepon Kontak Darurat']) {
    update.emergency_contact_phone = data['Nomor Telepon Kontak Darurat'].trim();
  }
  if (data['Hubungan dengan Karyawan']) {
    update.emergency_contact_relation = data['Hubungan dengan Karyawan'].trim();
  }

  return update;
}

// ══════════════════════════════════════════════
// 💾 Update data karyawan di Supabase
// ══════════════════════════════════════════════
function updateKaryawan(employeeId, updateData) {
  const url = CONFIG.SUPABASE_URL + '/rest/v1/employees?id=eq.' + employeeId;

  const response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: getHeaders(),
    payload: JSON.stringify(updateData),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  Logger.log('Response update: ' + code + ' — ' + response.getContentText());

  return code >= 200 && code < 300;
}

// ══════════════════════════════════════════════
// 📧 Fungsi email notifikasi
// ══════════════════════════════════════════════
function kirimEmailSukses(namaKaryawan, kodeKaryawan) {
  MailApp.sendEmail({
    to: CONFIG.HR_EMAIL,
    subject: '✅ Data karyawan berhasil diperbarui — ' + namaKaryawan,
    body: 'Halo HR,\n\n' +
      'Data pribadi karyawan berikut telah berhasil diperbarui di sistem HRIS:\n\n' +
      '👤 Nama: ' + namaKaryawan + '\n' +
      '🔑 Kode: ' + kodeKaryawan + '\n\n' +
      'Data sudah langsung tersimpan ke Supabase.\n\n' +
      'Salam,\nSistem HRIS Hammielion'
  });
}

function kirimEmailTidakDitemukan(namaKaryawan, data) {
  MailApp.sendEmail({
    to: CONFIG.HR_EMAIL,
    subject: '⚠️ Karyawan tidak ditemukan di sistem — ' + namaKaryawan,
    body: 'Halo HR,\n\n' +
      'Ada pengisian form dengan nama yang tidak ditemukan di database:\n\n' +
      '👤 Nama yang diisi: ' + namaKaryawan + '\n\n' +
      'Kemungkinan:\n' +
      '1. Nama tidak sama persis dengan yang ada di sistem\n' +
      '2. Karyawan belum didaftarkan di HRIS\n\n' +
      'Data lengkap yang disubmit:\n' + JSON.stringify(data, null, 2) + '\n\n' +
      'Mohon cek dan input manual jika diperlukan.\n\n' +
      'Salam,\nSistem HRIS Hammielion'
  });
}

function kirimEmailError(judul, detail) {
  MailApp.sendEmail({
    to: CONFIG.HR_EMAIL,
    subject: '❌ Error sistem HRIS — ' + judul,
    body: 'Halo HR,\n\nTerjadi error:\n\n' + judul + '\n\nDetail:\n' + detail + '\n\nSalam,\nSistem HRIS Hammielion'
  });
}

// ══════════════════════════════════════════════
// 🔑 Header untuk request Supabase
// ══════════════════════════════════════════════
function getHeaders() {
  return {
    'apikey':        CONFIG.SUPABASE_KEY,
    'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal'
  };
}

// ══════════════════════════════════════════════
// 🧪 Fungsi test — jalankan manual untuk coba
// ══════════════════════════════════════════════
function testCariKaryawan() {
  // Ganti dengan nama karyawan yang ada di sistem
  const nama = 'Fauzan Rahman';
  const result = cariKaryawan(nama);
  Logger.log('Hasil: ' + JSON.stringify(result));
}

function testUpdateData() {
  // Test update data untuk karyawan tertentu
  const namaTest = 'Fauzan Rahman';
  const emp = cariKaryawan(namaTest);

  if (!emp) {
    Logger.log('❌ Karyawan tidak ditemukan');
    return;
  }

  const dataTest = {
    phone: '081234567890',
    address: 'Jl. Test No. 1, Bandung',
    religion: 'Islam',
    marital_status: 'single',
  };

  const success = updateKaryawan(emp.id, dataTest);
  Logger.log(success ? '✅ Update berhasil' : '❌ Update gagal');
}
