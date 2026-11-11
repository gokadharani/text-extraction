"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UploadCloud,
  Database,
  History,
  Settings,
  BookOpenCheck,
  ShieldCheck
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Import Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload Documents", icon: UploadCloud },
  { href: "/question-bank", label: "Question Bank", icon: Database },
  { href: "/history", label: "Import History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
            <BookOpenCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-slate-900">
              QBank Intelligence
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              Document Extraction Engine
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? "text-blue-600" : "text-slate-400"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Deterministic-First Pipeline
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              PDF.js, Mammoth, ExcelJS &amp; OCR run first. OpenAI Structured Outputs invoked only for ambiguous candidates within budget.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile Header */}
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <BookOpenCheck className="h-5 w-5 text-blue-600" />
            <span>QBank Intelligence</span>
          </Link>
          <div className="flex items-center gap-2 text-xs">
            <Link href="/upload" className="rounded bg-blue-600 px-2.5 py-1 font-medium text-white">
              Upload
            </Link>
            <Link href="/question-bank" className="rounded bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              Bank
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
