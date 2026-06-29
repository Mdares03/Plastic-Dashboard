import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { getDictionary } from "@/lib/i18n/dictionary.server";
import { coerceLocale } from "@/lib/i18n/translations";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "MIS Control Tower",
    description: "MaliounTech Industrial Suite",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieJar = await cookies();
  const themeCookie = cookieJar.get("mis_theme")?.value;
  const theme = themeCookie === "light" ? "light" : "dark";
  const locale = coerceLocale(cookieJar.get("mis_locale")?.value);
  // Seed only the active locale's dictionary into the client (both live in the
  // server-only dictionary module); switching loads the other on demand.
  const dict = getDictionary(locale);

  return (
    <html lang={locale} data-theme={theme}>
      <body className="antialiased">
        <I18nProvider initialLocale={locale} initialDict={dict}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
