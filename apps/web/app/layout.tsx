import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { themeInitScript } from '@latex-cloud/ui';
import '@latex-cloud/ui/tokens.css';
import '@latex-cloud/ui/components.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'latex-cloud', template: '%s · latex-cloud' },
  description: 'Private, collaborative LaTeX authoring for mathematics and computer science.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#121413' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a className="lc-skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
