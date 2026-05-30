/**
 * HAMMIELION HRIS — Google Apps Script
 * File 1: Pembuat Google Form
 *
 * CARA PAKAI:
 * 1. Buka script.google.com → buat project baru
 * 2. Copy-paste isi file ini
 * 3. Klik Run → buatFormKaryawan
 * 4. Link form akan muncul di Logger (View → Logs)
 */

function buatFormKaryawan() {
  const form = FormApp.create('📋 Data Pribadi Karyawan — Hammielion Management');

  form.setDescription(
    'Halo! Mohon isi data pribadi Anda dengan lengkap dan benar.\n' +
    'Data ini akan langsung tersimpan ke sistem HRIS Hammielion.\n\n' +
    '⚠️ Pastikan nama lengkap Anda diisi SAMA PERSIS dengan yang terdaftar di sistem.'
  );

  form.setConfirmationMessage(
    '✅ Terima kasih! Data Anda berhasil dikirim dan akan segera diperbarui di sistem HRIS.'
  );

  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);

  // ─────────────────────────────────────────────
  // BAGIAN 1: IDENTITAS UTAMA
  // ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('👤 Identitas Utama')
    .setHelpText('Pastikan nama lengkap sama persis dengan yang ada di sistem.');

  form.addTextItem()
    .setTitle('Nama Lengkap')
    .setHelpText('Isi sama persis dengan nama yang terdaftar di sistem HRIS')
    .setRequired(true);

  form.addTextItem()
    .setTitle('NIK (Nomor KTP)')
    .setHelpText('16 digit angka sesuai KTP')
    .setRequired(false);

  // ─────────────────────────────────────────────
  // BAGIAN 2: DATA PRIBADI
  // ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('📅 Data Pribadi');

  form.addTextItem()
    .setTitle('Tempat Lahir')
    .setHelpText('Kota/Kabupaten tempat lahir')
    .setRequired(false);

  form.addDateItem()
    .setTitle('Tanggal Lahir')
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('Jenis Kelamin')
    .setChoiceValues(['Laki-laki', 'Perempuan'])
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('Agama')
    .setChoiceValues(['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'])
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('Status Pernikahan')
    .setChoiceValues(['Belum Menikah', 'Menikah', 'Cerai', 'Janda/Duda'])
    .setRequired(false);

  form.addTextItem()
    .setTitle('Jumlah Tanggungan')
    .setHelpText('Jumlah anggota keluarga yang menjadi tanggungan (angka)')
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('Pendidikan Terakhir')
    .setChoiceValues(['SD', 'SMP', 'SMA/SMK', 'D1', 'D2', 'D3', 'S1', 'S2', 'S3'])
    .setRequired(false);

  // ─────────────────────────────────────────────
  // BAGIAN 3: KONTAK
  // ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('📞 Kontak & Alamat');

  form.addTextItem()
    .setTitle('Nomor HP Aktif')
    .setHelpText('Contoh: 08123456789')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('Alamat Domisili')
    .setHelpText('Alamat tempat tinggal saat ini (lengkap)')
    .setRequired(false);

  // ─────────────────────────────────────────────
  // BAGIAN 4: REKENING BANK
  // ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('🏦 Rekening Bank')
    .setHelpText('Digunakan untuk keperluan transfer gaji');

  form.addTextItem()
    .setTitle('Nama Bank')
    .setHelpText('Contoh: BCA, BRI, Mandiri, BNI, dll')
    .setRequired(false);

  form.addTextItem()
    .setTitle('Nomor Rekening')
    .setRequired(false);

  form.addTextItem()
    .setTitle('Nama Pemilik Rekening')
    .setHelpText('Nama sesuai buku tabungan')
    .setRequired(false);

  // ─────────────────────────────────────────────
  // BAGIAN 5: KONTAK DARURAT
  // ─────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('🚨 Kontak Darurat')
    .setHelpText('Orang yang bisa dihubungi jika terjadi keadaan darurat');

  form.addTextItem()
    .setTitle('Nama Kontak Darurat')
    .setRequired(false);

  form.addTextItem()
    .setTitle('Nomor Telepon Kontak Darurat')
    .setRequired(false);

  form.addTextItem()
    .setTitle('Hubungan dengan Karyawan')
    .setHelpText('Contoh: Ayah, Ibu, Suami, Istri, Kakak, dll')
    .setRequired(false);

  // ─────────────────────────────────────────────
  // SELESAI
  // ─────────────────────────────────────────────
  const formUrl = form.getPublishedUrl();
  const editUrl = form.getEditUrl();
  const formId  = form.getId();

  Logger.log('✅ Form berhasil dibuat!');
  Logger.log('📋 Link untuk karyawan (bagikan ini): ' + formUrl);
  Logger.log('✏️  Link edit form: ' + editUrl);
  Logger.log('🔑 Form ID (simpan untuk script submit): ' + formId);

  Logger.log('');
  Logger.log('══════════════════════════════════');
  Logger.log('✅ FORM BERHASIL DIBUAT!');
  Logger.log('══════════════════════════════════');
  Logger.log('📋 Link karyawan: ' + formUrl);
  Logger.log('🔑 Form ID: ' + formId);
  Logger.log('══════════════════════════════════');
}
