import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Only used by the Prisma CLI (migrate/db push/introspect). The app's
  // runtime client still uses the driver adapter (@prisma/adapter-pg)
  // constructed explicitly in src/index.js.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
