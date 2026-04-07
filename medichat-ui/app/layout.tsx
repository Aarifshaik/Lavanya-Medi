import type { Metadata } from "next";

import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediChat",
  description: "Secure medical chatbot workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", "font-sans")}
      style={
        {
          "--font-sans":
            '"Segoe UI", "Helvetica Neue", Arial, "Noto Sans", sans-serif',
          "--font-geist-mono":
            '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
          "--font-heading":
            '"Segoe UI Semibold", "Helvetica Neue", Arial, sans-serif',
        } as React.CSSProperties
      }
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
