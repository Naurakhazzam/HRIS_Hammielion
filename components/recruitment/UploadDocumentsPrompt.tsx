export default function UploadDocumentsPrompt({ url }: { url: string }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-3 space-y-1 mt-4">
      <p className="text-sm font-medium text-blue-800">Langkah Terakhir: Upload CV & Foto Diri</p>
      <p className="text-sm text-blue-700">
        Semua tahap tes sudah selesai. Sebagai langkah terakhir, upload CV dan foto diri Anda lewat link berikut:
      </p>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="text-sm text-blue-600 underline font-medium">
          Klik di sini untuk upload CV & foto
        </a>
      ) : (
        <p className="text-sm text-blue-700">Link upload menyusul, akan diinfokan oleh HR.</p>
      )}
    </div>
  )
}
