import { mkdir, rm, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
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

/**
 * Bundle form-recorder modules into self-contained IIFEs for injection
 * via chrome.scripting.executeScript (content scripts can't use ES modules).
 */
async function bundleFormRecorder(distDir) {
  const formDir = path.join(distDir, 'src', 'form-recorder');
  const selectorPath = path.join(formDir, 'selector-engine.js');
  const recorderPath = path.join(formDir, 'recorder.js');
  const replayPath = path.join(formDir, 'replay-engine.js');

  const stripExports = code => code
    .replace(/^export\s+(function|const|let|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '');
  const stripImports = code => code
    .replace(/^import\s+.*from\s+['"].*['"];?\s*$/gm, '');

  try {
    const selectorSrc = await readFile(selectorPath, 'utf-8');

    // Bundle recorder (selector-engine + labeler + wizard-state + trace-engine + recorder)
    try {
      const labelerSrc = await readFile(path.join(formDir, 'labeler.js'), 'utf-8');
      const wizardStateSrc = await readFile(path.join(formDir, 'wizard-state.js'), 'utf-8');
      const traceEngineSrc = await readFile(path.join(formDir, 'trace-engine.js'), 'utf-8').catch(() => '');
      const recorderSrc = await readFile(recorderPath, 'utf-8');
      const recorderBundle = [
        '// Auto-generated bundle — do not edit directly',
        '(() => {',
        stripExports(selectorSrc),
        stripExports(labelerSrc),
        stripExports(wizardStateSrc),
        stripExports(traceEngineSrc),
        stripImports(stripExports(recorderSrc)),
        '})();',
      ].join('\n');
      await writeFile(path.join(formDir, 'recorder-bundle.js'), recorderBundle);
      console.log('  - form-recorder/recorder-bundle.js: bundled');
    } catch {
      // recorder.js may not exist yet during incremental development
    }

    // Bundle replay engine (selector-engine + replay-engine)
    try {
      const replaySrc = await readFile(replayPath, 'utf-8');
      const replayBundle = [
        '// Auto-generated bundle — do not edit directly',
        '(() => {',
        stripExports(selectorSrc),
        stripImports(stripExports(replaySrc)),
        '})();',
      ].join('\n');
      await writeFile(path.join(formDir, 'replay-bundle.js'), replayBundle);
      console.log('  - form-recorder/replay-bundle.js: bundled');
    } catch {
      // replay-engine.js may not exist yet
    }
  } catch {
    // form-recorder directory may not exist — skip silently
    console.log('  - form-recorder: skipped (no source files)');
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
  await bundleFormRecorder(distDir);
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
