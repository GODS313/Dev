import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://telegram-crypto-trader.hazratemahdi097.chatgpt.site"),
  title: "آلفا ترید | ربات معامله‌گر تلگرام",
  description: "ربات فارسی خرید و فروش آزمایشی ارز دیجیتال در تلگرام با کنترل ریسک و هشدار Slack.",
  openGraph: { title: "آلفا ترید | ربات معامله‌گر تلگرام", description: "خرید و فروش آزمایشی، کنترل ریسک و گزارش سبد از داخل تلگرام.", type: "website", images: [{ url: "/og.png", width: 1672, height: 941, alt: "آلفا ترید، ربات معامله‌گر تلگرام" }] },
  twitter: { card: "summary_large_image", title: "آلفا ترید | ربات معامله‌گر تلگرام", description: "معامله آزمایشی امن، مستقیم از تلگرام.", images: ["/og.png"] },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
