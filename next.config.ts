import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@huggingface/transformers", "@google/genai"],
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "recharts"],
  },
};
export default nextConfig;
