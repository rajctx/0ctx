import type { Metadata } from 'next';
import { Manrope, Space_Grotesk, Inter, Space_Mono, Cormorant_Garamond } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme/theme-provider';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap'
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap'
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-tech',
  display: 'swap'
});

const spaceMono = Space_Mono({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap'
});

const cormorantGaramond = Cormorant_Garamond({
  weight: ['500', '600'],
  style: ['normal'],
  subsets: ['latin'],
  variable: '--font-hero',
  display: 'swap'
});

export const metadata: Metadata = {
  title: '0ctx | The Context Engine for AI',
  description: 'Zero context loss across AI tools. A persistent, local-first graph-based context engine.',
};

const themeBootstrapScript = `(() => {
  try {
    const key = '0ctx.theme';
    const stored = localStorage.getItem(key);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = stored === 'light' || stored === 'dark'
      ? stored
      : prefersDark
        ? 'dark'
        : 'light';
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (_) {}
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${manrope.variable} ${spaceGrotesk.variable} ${inter.variable} ${spaceMono.variable} ${cormorantGaramond.variable} min-h-screen antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
