import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { ChatProvider } from "@/lib/store";
import { WorkspaceProvider } from "@/lib/workspace-store";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Claude Agent",
  description: "Advanced Claude Agent Client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <WorkspaceProvider>
            <ChatProvider>
              {children}
            </ChatProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
