import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Hammielion HRIS',
  description: 'Login / daftar akun sistem HRIS Hammielion Management',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
