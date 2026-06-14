import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRAG – Corrective RAG",
  description: "Corrective Retrieval-Augmented Generation pipeline",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem('crag-theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark')}catch(e){document.documentElement.classList.add('dark')}`,
            }}
          />
        </head>
        <body className="bg-slate-50 dark:bg-[#09090f] text-gray-900 dark:text-gray-100 min-h-screen antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
