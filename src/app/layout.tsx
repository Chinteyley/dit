import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Next } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Atkinson Hyperlegible Next (Braille Institute, OFL): a variable font drawn for low-vision
// legibility, which suits a display read from across a bed. next/font downloads it at build time
// and serves it from this origin, so the browser never asks a third party for it. Next has no
// metric overrides for this family, so the fallback is named here instead of generated (which
// would only warn); the file is preloaded, and these system fonts cover the moment before it loads.
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-atkinson',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: 'Dit',
  description: 'Type three letters. Say a whole sentence. One-switch Morse with sentence expansion and speech.',
};

// No maximum-scale or user-scalable: pinch zoom stays available (Req 22.4).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`dark ${atkinson.variable}`}>
      <body className="bg-bg font-sans text-text">{children}</body>
    </html>
  );
}
