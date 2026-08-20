import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import ThemeFavicon from "@/components/ThemeFavicon";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hakeem",
  applicationName: "Hakeem",
  description: "Evidence-grounded medication safety and drug interaction assistant",
  icons: {
    icon: "/hakeem-mark.svg?v=2",
    shortcut: "/hakeem-mark.svg?v=2",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ThemeFavicon />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
