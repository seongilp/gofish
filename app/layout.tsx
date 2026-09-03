import type { Metadata } from 'next';
import { Noto_Sans_KR } from 'next/font/google';

import './globals.css';

const notoSansKr = Noto_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: '낚시나우 — 전국 바다낚시지수',
  applicationName: '낚시나우',
  description:
    '전국 49개 예보지점의 바다낚시지수를 7일치로 봅니다. 오늘 어디가 좋은지 랭킹으로, 이번 주 흐름은 추이로. 국립해양조사원 공공데이터 기반.',
  openGraph: {
    siteName: '낚시나우',
    title: '낚시나우 — 전국 바다낚시지수',
    description:
      '전국 49개 예보지점의 바다낚시지수를 7일치로 봅니다. 오늘 어디가 좋은지 랭킹으로, 이번 주 흐름은 추이로. 국립해양조사원 공공데이터 기반.',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: '낚시나우 — 전국 바다낚시지수',
    description:
      '전국 49개 예보지점의 바다낚시지수를 7일치로 봅니다. 오늘 어디가 좋은지 랭킹으로, 이번 주 흐름은 추이로. 국립해양조사원 공공데이터 기반.',
  },
  appleWebApp: { title: '낚시나우' },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`dark ${notoSansKr.variable} antialiased`} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh">{children}</body>
    </html>
  );
}
