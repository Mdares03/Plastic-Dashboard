import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIS Control Tower",
  description: "MaliounTech Industrial Suite",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieJar = await cookies();
  const themeCookie = cookieJar.get("mis_theme")?.value;
  const localeCookie = cookieJar.get("mis_locale")?.value;
  const theme = themeCookie === "light" ? "light" : "dark";
  const locale = localeCookie === "es-MX" ? "es-MX" : "en";

  return (
    <html lang={locale} data-theme={theme}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
