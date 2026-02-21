import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '0ctx | The Context Engine for AI',
  description: 'Zero context loss across AI tools. A persistent, local-first graph-based context engine.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-[#020202] text-zinc-300 selection:bg-emerald-500/30`}>
        {children}
      </body>
    </html>
  );
}
