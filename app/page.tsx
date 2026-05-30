import { redirect } from 'next/navigation'

// Root "/" langsung redirect ke /dashboard.
// Middleware akan menangani: jika belum login → /login, jika sudah login → /dashboard
export default function RootPage() {
  redirect('/dashboard')
}
