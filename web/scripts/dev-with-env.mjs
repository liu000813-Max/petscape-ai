import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const rootEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));

try {
  loadEnvFile(rootEnvPath);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

await import('next/dist/bin/next');
