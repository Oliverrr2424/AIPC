import type { Config } from "tailwindcss";
export default { darkMode: "class", content: ["./src/**/*.{ts,tsx}"], theme: { extend: { fontFamily: { sans: ["var(--font-geist)","sans-serif"], mono: ["var(--font-geist-mono)","monospace"] }, colors: { ink: "#0a0c10", electric: "#4d8dff" }, boxShadow: { panel: "0 24px 80px rgba(3,10,24,.16)" } } }, plugins: [] } satisfies Config;
