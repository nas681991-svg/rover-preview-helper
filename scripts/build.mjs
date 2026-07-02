import { mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorRoverRuntime } from './vendor.mjs';

const root = new URL('..', import.meta.url);
const rootPath = fileURLToPath(root);
const srcDir = path.resolve(rootPath, 'src');
const distDir = path.resolve(rootPath, 'dist');
const args = new Set(process.argv.slice(2));
const watchMode = args.has('--watch');

async function copyTree(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.endsWith('.test.mjs') || entry.name.endsWith('.test.js')) continue;
    const src = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dest);
    } else if (entry.isFile()) {
      await copyFile(src, dest);
    }
  }
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  // Package the Rover runtime core + worker so the SDK can be injected via
  // chrome.scripting.executeScript instead of a page-CSP-blocked remote <script>.
  // A plain `pnpm build` fetches the latest from prod; watch mode reuses cache.
  console.log('Vendoring Rover runtime:');
  await vendorRoverRuntime({ refresh: !watchMode, distDir });
  await copyFile(path.resolve(rootPath, 'manifest.json'), path.join(distDir, 'manifest.json'));
  await copyTree(srcDir, path.join(distDir, 'src'));
  await copyFile(path.resolve(rootPath, 'README.md'), path.join(distDir, 'README.md'));
  await copyFile(path.resolve(rootPath, 'EXTENSION_USERS.md'), path.join(distDir, 'EXTENSION_USERS.md'));
  await copyFile(path.resolve(rootPath, 'HEADLESS_CONTROL.md'), path.join(distDir, 'HEADLESS_CONTROL.md'));
  await copyTree(path.resolve(rootPath, 'examples'), path.join(distDir, 'examples'));
  console.log(`Built rover-preview-helper -> ${distDir}`);
}

if (!watchMode) {
  try {
    await build();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
} else {
  try {
    await build();
  } catch (err) {
    console.error('Initial watch build failed:', err);
    process.exit(1);
  }
  let building = false;
  const rebuild = async () => {
    if (building) return;
    building = true;
    try {
      await build();
    } finally {
      building = false;
    }
  };

  const watchPath = path.resolve(rootPath, 'src');
  const manifestPath = path.resolve(rootPath, 'manifest.json');
  watch(watchPath, { recursive: true }, () => {
    void rebuild();
  });
  watch(manifestPath, () => {
    void rebuild();
  });
}
