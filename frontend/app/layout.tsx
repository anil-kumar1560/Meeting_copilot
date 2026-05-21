import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meeting Co-Pilot",
  description: "Real-time AI meeting co-pilot with live transcripts and suggestions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-[#0f1117] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
