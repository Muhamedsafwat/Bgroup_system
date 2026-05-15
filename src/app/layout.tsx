import type { Metadata } from "next";
import {
  Inter,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
  Noto_Sans_Arabic,
} from "next/font/google";
import { Providers } from "@/components/layout/Providers";
import { Toaster } from "@/components/ui/sonner";
import { getServerLocale } from "@/lib/i18n/server";
import { safeAuth } from "@/lib/safe-auth";
import "./globals.css";

const interSans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const plusJakartaDisplay = Plus_Jakarta_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const notoSansArabic = Noto_Sans_Arabic({
  variable: "--font-sans-ar",
  subsets: ["arabic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BGroup Super App",
  description: "Unified HR, CRM, and Partners Portal",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, session] = await Promise.all([getServerLocale(), safeAuth()]);

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      suppressHydrationWarning
      className={`${interSans.variable} ${jetbrainsMono.variable} ${plusJakartaDisplay.variable} ${notoSansArabic.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        suppressHydrationWarning
        /* Grammarly / Honey / other content-scripts inject DOM nodes (and
           sometimes <script> stubs) into <body> after React mounts. The
           dataset flags below ask Grammarly to skip + tell React to ignore
           the extra attributes/children. The console warning is dev-only,
           but production stays clean too. */
        data-new-gr-c-s-check-loaded="14.1238.0"
        data-gr-ext-installed=""
      >
        <Providers initialLocale={locale} session={session}>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
