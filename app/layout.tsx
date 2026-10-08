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

/**
 * Allow a cold database resume to finish within the function's lifetime.
 *
 * The managed Postgres scales to zero after five minutes idle, so the first
 * request to a deployment that has been quiet can spend most of its budget
 * waiting for the database to wake. Vercel defaults a Node function to a much
 * shorter duration than the 45 s connect timeout in lib/db.ts, which would kill
 * the invocation before the connection was even attempted.
 *
 * Overridable per plan: Hobby caps this lower than Pro, so if the dashboard
 * reports a duration ceiling, either raise the plan or lower
 * DB_CONNECT_TIMEOUT_MS to match.
 */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "School Administration System",
  description:
    "Database-backed student records, enrolment, grading and management reporting. CMPE344 DBMS and Programming II.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
