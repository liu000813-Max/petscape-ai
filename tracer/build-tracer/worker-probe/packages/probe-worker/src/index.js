// WP-2.0 tracer: minimal worker package proving Prisma 7 + @prisma/adapter-pg
// (WASM query engine) can construct a client and run a real query against
// PostgreSQL inside a Linux/amd64 container, using a dependency tree produced
// by `pnpm deploy` (or the esbuild fallback — see REPORT.md for the decision).
import { PrismaPg } from '@prisma/adapter-pg';
// The generated client's entrypoint is CommonJS-only (no ESM named exports);
// import the default and destructure, per Prisma's Node-ESM guidance.
import prismaClientPkg from './generated/prisma/default.js';
const { PrismaClient } = prismaClientPkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await prisma.$queryRaw`SELECT 1 as one`;
  console.log('SELECT_1_RESULT:' + JSON.stringify(result));
}

main()
  .catch((err) => {
    console.error('PROBE_FAILED', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
