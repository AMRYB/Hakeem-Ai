import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hakeem",
  applicationName: "Hakeem",
  description: "Evidence-grounded medication safety and drug interaction assistant",
  icons: {
    icon: "/hakeem-mark.svg",
    shortcut: "/hakeem-mark.svg",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
