import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNavigation } from "@/components/navigation/AppNavigation";
import { currentDeploymentDecision } from "@/lib/operations/deployment-boundary";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const production = currentDeploymentDecision() === "v2-production";
  return {
    title: "Personal AI Trainer",
    description: "Adaptive strength training, logging, and analytics.",
    ...(production ? {
      manifest: "/manifest.webmanifest",
      appleWebApp: { capable: true, title: "Trainer", statusBarStyle: "default" as const },
      icons: { apple: "/apple-icon.png" },
    } : {}),
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} app-root antialiased`}
      >
        {currentDeploymentDecision() !== "v2-production" && <AppNavigation />}
        {children}
      </body>
    </html>
  );
}
