import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 (via better-auth kysely fallback is not used here; prisma engine is native)
  // keep prisma client external to the server bundle
  serverExternalPackages: ["@prisma/client", "@prisma/engines", ".prisma/client"],
};

export default nextConfig;
