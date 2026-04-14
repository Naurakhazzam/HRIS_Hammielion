'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, User } from 'lucide-react';
import { useKaryawanStore } from '@/stores/useKaryawanStore';
import { CABANG_LIST, JABATAN_LIST, DIVISI_MAP, STATUS_KARYAWAN } from '@/lib/constants/roles';
import type { Karyawan } from '@/types/karyawan.types';
import Button from '@/components/atoms/Button';
import styles from '../../tambah/form.module.css';

const BANK_OPTIONS = ['BCA', 'Mandiri', 'BNI', 'BRI', 'BSI', 'CIMB Niaga', 'Danamon', 'Permata'];
const AGAMA_OPTIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];

type FormErrors = Partial<Record<keyof Karyawan, string>>;

export default function EditKaryawanPage() {
  const { id }    = useParams<{ id: string }>();
  const router    = useRouter();
  const { getKaryawanById, updateKaryawan } = useKaryawanStore();

  const existing = getKaryawanById(id);

  const [form, setForm]     = useState<Partial<Karyawan>>(existing ?? {});
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) setForm(existing);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!existing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 12 }}>
        <User size={48} style={{ opacity: 0.3 }} />
        <p>Karyawan tidak ditemukan.</p>
        <Button variant="secondary" onClick={() => router.push('/karyawan')}>Kembali</Button>
      </div>
    );
  }

  function setField<K extends keyof Karyawan>(key: K, value: Karyawan[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function handleJabatanChange(jabatan: string) {
    const divisi = (DIVISI_MAP[jabatan] ?? 'Back Office') as Karyawan['divisi'];
    setForm((prev) => ({ ...prev, jabatan: jabatan as Karyawan['jabatan'], divisi }));
  }

  function validate(): boolean {
    const e: FormErrors = {};
    if (!form.nama?.trim())   e.nama   = 'Nama wajib diisi';
    if (!form.nik?.trim())    e.nik    = 'NIK wajib diisi';
    if (!form.noHp?.trim())   e.noHp   = 'No. HP wajib diisi';
    if (!form.alamat?.trim()) e.alamat = 'Alamat wajib diisi';
    if (!form.gajiPokok || form.gajiPokok <= 0) e.gajiPokok = 'Gaji pokok wajib diisi';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    updateKaryawan(id, form);
    router.push(`/karyawan/${id}`);
  }

  const inp = (key: keyof Karyawan, type = 'text', placeholder = '') => (
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
          <h1 className={styles.title}>Edit Karyawan</h1>
          <p className={styles.subtitle}>{existing.nomorKaryawan} — {existing.nama}</p>
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
            <label className={styles.label}>Tempat Lahir</label>
            {inp('tempatLahir', 'text', 'Kota kelahiran')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tanggal Lahir</label>
            {inp('tanggalLahir', 'date')}
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
            <label className={styles.label}>Jabatan</label>
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
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Cabang</label>
            <select
              className={styles.select}
              value={form.cabang ?? 'Cabang 1'}
              onChange={(e) => setField('cabang', e.target.value as Karyawan['cabang'])}
            >
              {CABANG_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Status Karyawan</label>
            <select
              className={styles.select}
              value={form.statusKaryawan ?? 'Aktif'}
              onChange={(e) => setField('statusKaryawan', e.target.value as Karyawan['statusKaryawan'])}
            >
              {STATUS_KARYAWAN.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tanggal Masuk</label>
            {inp('tanggalMasuk', 'date')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tanggal Keluar</label>
            {inp('tanggalKeluar', 'date')}
            <span className={styles.hint}>Isi jika karyawan sudah tidak aktif</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Gaji Pokok (Rp) <span className={styles.required}>*</span></label>
            <input
              type="number"
              className={`${styles.input} ${errors.gajiPokok ? styles.error : ''}`}
              value={form.gajiPokok ?? ''}
              onChange={(e) => setField('gajiPokok', Number(e.target.value))}
              min={0}
              step={50000}
            />
            {errors.gajiPokok && <span className={styles.errorMsg}>{errors.gajiPokok}</span>}
          </div>
        </div>
      </div>

      {/* ── 3. Legalitas & Bank ── */}
      <div className={styles.card}>
        <h2 className={styles.sectionTitle}>3. Data Legalitas &amp; Bank</h2>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>NPWP</label>
            {inp('npwp', 'text', 'XX.XXX.XXX.X-XXX.XXX')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>No. BPJS Ketenagakerjaan</label>
            {inp('noBpjsKetenagakerjaan', 'text')}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>No. BPJS Kesehatan</label>
            {inp('noBpjsKesehatan', 'text')}
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
            {inp('noRekeningBank', 'text')}
          </div>

          <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
            <label className={styles.label}>Catatan</label>
            <textarea
              className={styles.textarea}
              value={form.catatan ?? ''}
              onChange={(e) => setField('catatan', e.target.value)}
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
          &nbsp;Simpan Perubahan
        </Button>
      </div>
    </form>
  );
}
