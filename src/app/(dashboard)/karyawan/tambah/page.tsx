'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { useKaryawanStore } from '@/stores/useKaryawanStore';
import { CABANG_LIST, JABATAN_LIST, DIVISI_MAP } from '@/lib/constants/roles';
import type { KaryawanFormInput } from '@/types/karyawan.types';
import Button from '@/components/atoms/Button';
import styles from './form.module.css';

type FormErrors = Partial<Record<keyof KaryawanFormInput, string>>;

const BANK_OPTIONS = ['BCA', 'Mandiri', 'BNI', 'BRI', 'BSI', 'CIMB Niaga', 'Danamon', 'Permata'];
const AGAMA_OPTIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];

export default function TambahKaryawanPage() {
  const router = useRouter();
  const { tambahKaryawan } = useKaryawanStore();

  const [form, setForm] = useState<Partial<KaryawanFormInput>>({
    statusKaryawan: 'Aktif',
    jenisKelamin: 'Pria',
    jabatan: 'Kasir',
    divisi: 'Staff Toko',
    cabang: 'Cabang 1',
    tanggalMasuk: new Date().toISOString().split('T')[0],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  function setField<K extends keyof KaryawanFormInput>(key: K, value: KaryawanFormInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function handleJabatanChange(jabatan: string) {
    const divisi = DIVISI_MAP[jabatan as keyof typeof DIVISI_MAP] ?? 'Back Office';
    setForm((prev) => ({ ...prev, jabatan: jabatan as KaryawanFormInput['jabatan'], divisi }));
  }

  function validate(): boolean {
    const e: FormErrors = {};
    if (!form.nama?.trim())        e.nama        = 'Nama wajib diisi';
    if (!form.nik?.trim())         e.nik         = 'NIK wajib diisi';
    if (form.nik && form.nik.length !== 16) e.nik = 'NIK harus 16 digit';
    if (!form.tempatLahir?.trim()) e.tempatLahir = 'Tempat lahir wajib diisi';
    if (!form.tanggalLahir)        e.tanggalLahir = 'Tanggal lahir wajib diisi';
    if (!form.alamat?.trim())      e.alamat      = 'Alamat wajib diisi';
    if (!form.noHp?.trim())        e.noHp        = 'Nomor HP wajib diisi';
    if (!form.gajiPokok || form.gajiPokok <= 0) e.gajiPokok = 'Gaji pokok wajib diisi';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    tambahKaryawan(form as KaryawanFormInput);
    router.push('/karyawan');
  }

  const inp = (key: keyof KaryawanFormInput, type = 'text', placeholder = '') => (
    <input
      type={type}
      className={`${styles.input} ${errors[key] ? styles.error : ''}`}
      value={(form[key] as string) ?? ''}
      onChange={(e) => setField(key, e.target.value as never)}
      placeholder={placeholder}
    />
  );

  return (
    <form className={styles.page} onSubmit={handleSubmit} noValidate>
      {/* Header */}
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => router.back()}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className={styles.title}>Tambah Karyawan</h1>
          <p className={styles.subtitle}>Isi data karyawan baru secara lengkap</p>
        </div>
      </div>

      {/* ── 1. Data Pribadi ── */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>1. Data Pribadi</h2>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Nama Lengkap <span className={styles.required}>*</span></label>
            {inp('nama', 'text', 'Nama sesuai KTP')}
            {errors.nama && <span className={styles.errorMsg}>{errors.nama}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>NIK (No. KTP) <span className={styles.required}>*</span></label>
            {inp('nik', 'text', '16 digit nomor KTP')}
            {errors.nik && <span className={styles.errorMsg}>{errors.nik}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tempat Lahir <span className={styles.required}>*</span></label>
            {inp('tempatLahir', 'text', 'Kota kelahiran')}
            {errors.tempatLahir && <span className={styles.errorMsg}>{errors.tempatLahir}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tanggal Lahir <span className={styles.required}>*</span></label>
            {inp('tanggalLahir', 'date')}
            {errors.tanggalLahir && <span className={styles.errorMsg}>{errors.tanggalLahir}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Jenis Kelamin</label>
            <select
              className={styles.select}
              value={form.jenisKelamin ?? 'Pria'}
              onChange={(e) => setField('jenisKelamin', e.target.value as 'Pria' | 'Wanita')}
            >
              <option value="Pria">Pria</option>
              <option value="Wanita">Wanita</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Agama</label>
            <select
              className={styles.select}
              value={form.agama ?? ''}
              onChange={(e) => setField('agama', e.target.value)}
            >
              <option value="">— Pilih agama —</option>
              {AGAMA_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>Alamat Lengkap <span className={styles.required}>*</span></label>
            <textarea
              className={`${styles.textarea} ${errors.alamat ? styles.error : ''}`}
              value={form.alamat ?? ''}
              onChange={(e) => setField('alamat', e.target.value)}
              placeholder="Jl. Nama Jalan No. X, Kelurahan, Kecamatan, Kota"
              rows={2}
            />
            {errors.alamat && <span className={styles.errorMsg}>{errors.alamat}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>No. HP <span className={styles.required}>*</span></label>
            {inp('noHp', 'tel', '08xxxxxxxxxx')}
            {errors.noHp && <span className={styles.errorMsg}>{errors.noHp}</span>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            {inp('email', 'email', 'nama@hammielion.com')}
          </div>
        </div>
      </div>

      {/* ── 2. Data Pekerjaan ── */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>2. Data Pekerjaan</h2>
        <div className={styles.grid3}>
          <div className={styles.field}>
            <label className={styles.label}>Jabatan <span className={styles.required}>*</span></label>
            <select
              className={styles.select}
              value={form.jabatan ?? 'Kasir'}
              onChange={(e) => handleJabatanChange(e.target.value)}
            >
              {JABATAN_LIST.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Divisi</label>
            <input
              className={styles.input}
              value={form.divisi ?? ''}
              readOnly
              style={{ background: 'var(--color-bg)', cursor: 'default' }}
            />
            <span className={styles.hint}>Terisi otomatis sesuai jabatan</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Cabang <span className={styles.required}>*</span></label>
            <select
              className={styles.select}
              value={form.cabang ?? 'Cabang 1'}
              onChange={(e) => setField('cabang', e.target.value as KaryawanFormInput['cabang'])}
            >
              {CABANG_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Status Karyawan</label>
            <select
              className={styles.select}
              value={form.statusKaryawan ?? 'Aktif'}
              onChange={(e) => setField('statusKaryawan', e.target.value as KaryawanFormInput['statusKaryawan'])}
            >
              <option value="Aktif">Aktif</option>
              <option value="Kontrak">Kontrak</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tanggal Masuk <span className={styles.required}>*</span></label>
            {inp('tanggalMasuk', 'date')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Gaji Pokok (Rp) <span className={styles.required}>*</span></label>
            <input
              type="number"
              className={`${styles.input} ${errors.gajiPokok ? styles.error : ''}`}
              value={form.gajiPokok ?? ''}
              onChange={(e) => setField('gajiPokok', Number(e.target.value))}
              placeholder="3500000"
              min={0}
              step={50000}
            />
            {errors.gajiPokok && <span className={styles.errorMsg}>{errors.gajiPokok}</span>}
          </div>
        </div>
      </div>

      {/* ── 3. Data Legalitas & Bank ── */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>3. Data Legalitas &amp; Bank</h2>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>NPWP</label>
            {inp('npwp', 'text', 'XX.XXX.XXX.X-XXX.XXX')}
            <span className={styles.hint}>Opsional — isi jika sudah punya NPWP</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>No. BPJS Ketenagakerjaan</label>
            {inp('noBpjsKetenagakerjaan', 'text', 'Nomor BPJS TK')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>No. BPJS Kesehatan</label>
            {inp('noBpjsKesehatan', 'text', 'Nomor BPJS Kesehatan')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Nama Bank</label>
            <select
              className={styles.select}
              value={form.namaBank ?? ''}
              onChange={(e) => setField('namaBank', e.target.value)}
            >
              <option value="">— Pilih bank —</option>
              {BANK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>No. Rekening</label>
            {inp('noRekeningBank', 'text', 'Nomor rekening aktif')}
          </div>

          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>Catatan</label>
            <textarea
              className={styles.textarea}
              value={form.catatan ?? ''}
              onChange={(e) => setField('catatan', e.target.value)}
              placeholder="Catatan tambahan (opsional)"
              rows={2}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Batal
        </Button>
        <Button type="submit" loading={saving}>
          <Save size={15} />
          &nbsp;Simpan Karyawan
        </Button>
      </div>
    </form>
  );
}
