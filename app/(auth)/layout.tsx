import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Masuk — Hammielion HRIS',
  description: 'Login ke sistem HRIS Hammielion Management',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
