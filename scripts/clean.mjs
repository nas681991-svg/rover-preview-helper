import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const distDir = path.resolve(fileURLToPath(root), 'dist');

try {
  await rm(distDir, { recursive: true, force: true });
  console.log(`Removed ${distDir}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
