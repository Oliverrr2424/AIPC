import type { Metadata } from "next";import { Geist,Geist_Mono } from "next/font/google";import "./globals.css";import { Navbar } from "@/components/layout/Navbar";import { Footer } from "@/components/layout/Footer";import { LocaleProvider } from "@/lib/i18n/LocaleProvider";
const geist=Geist({subsets:["latin"],variable:"--font-geist"});
const mono=Geist_Mono({subsets:["latin"],variable:"--font-geist-mono"});
export const metadata:Metadata={title:{default:"AI PC Builder","template":"%s | AI PC Builder"},description:"Build an optimized PC for gaming, AI, development, and creative production."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" suppressHydrationWarning><body className={`${geist.variable} ${mono.variable}`}><LocaleProvider><Navbar/><main>{children}</main><Footer/></LocaleProvider></body></html>}
