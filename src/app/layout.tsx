import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apex Engine",
  description: "Multi-LLM fan-out with synthesis",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
