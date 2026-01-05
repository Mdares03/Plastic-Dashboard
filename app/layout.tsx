import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
