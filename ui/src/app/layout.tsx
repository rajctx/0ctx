import type { Metadata } from 'next';
import { Manrope, Space_Grotesk, Inter, JetBrains_Mono, Instrument_Serif } from 'next/font/google';
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap'
});

const instrumentSerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-hero',
  display: 'swap'
});

export const metadata: Metadata = {
  metadataBase: new URL('https://0ctx.com'),
  title: {
    default: '0ctx | Persistent repo memory for AI coding tools',
    template: '%s | 0ctx'
  },
  description: '0ctx keeps sessions, checkpoints, and decisions attached to your repo so AI tools can continue work without losing project context. Local-first runtime, SQLite-backed graph, repo-first setup.',
  keywords: ['0ctx', 'AI coding tools', 'project context', 'local-first', 'context memory', 'AI agent'],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://0ctx.com',
    title: '0ctx | Persistent repo memory for AI coding tools',
    description: '0ctx gives AI workflows durable repo memory instead of session-by-session amnesia.',
    siteName: '0ctx',
  },
  twitter: {
    card: 'summary_large_image',
    title: '0ctx | Persistent repo memory for AI coding tools',
    description: '0ctx gives AI workflows durable repo memory instead of session-by-session amnesia.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
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
      <body className={`${manrope.variable} ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} min-h-screen antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
