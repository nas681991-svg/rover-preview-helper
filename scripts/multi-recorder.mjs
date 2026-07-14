import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extensionsDir = path.join(root, 'extensions');
const bugbugDir = path.join(extensionsDir, 'bugbug');
const roverExtDir = path.join(root, 'app-assets', 'rover');
const sbaseExtDir = path.join(root, 'app-assets', 'sbase-recorder');

const cloudqaDir = path.join(extensionsDir, 'cloudqa');

async function downloadExtension(id, url, targetDir) {
  if (existsSync(targetDir)) {
    console.log(`${id} extension already downloaded.`);
    return;
  }
  console.log(`Downloading ${id} extension...`);
  await mkdir(extensionsDir, { recursive: true });
  
  const controller = new AbortController();
  const downloadTimeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to download ${id}: ${response.statusText}`);
  
    const buffer = await response.arrayBuffer();
    let crxBuffer = Buffer.from(buffer);

    // Strip CRX2/CRX3 headers to get the raw ZIP payload
    const magic = crxBuffer.readUInt32LE(0);
    if (magic === 0x34327243) { // 'Cr24'
      const version = crxBuffer.readUInt32LE(4);
      if (version === 2) {
        const publicKeyLength = crxBuffer.readUInt32LE(8);
        const signatureLength = crxBuffer.readUInt32LE(12);
        crxBuffer = crxBuffer.subarray(16 + publicKeyLength + signatureLength);
      } else if (version === 3) {
        const headerSize = crxBuffer.readUInt32LE(8);
        crxBuffer = crxBuffer.subarray(12 + headerSize);
      } else {
        throw new Error(`Unsupported CRX version: ${version}`);
      }
    }

    const zipPath = path.join(extensionsDir, `${id}.zip`);
    await writeFile(zipPath, crxBuffer);
  
    console.log(`Extracting ${id} extension...`);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetDir, true);
    console.log(`${id} extension ready.`);
  } catch (err) {
    console.warn(`[WARNING] Failed to download or extract ${id} extension: ${err.message}. Skipping...`);
  } finally {
    clearTimeout(downloadTimeout);
  }
}

async function startPlaywright() {
  console.log('Launching browser with all extensions...');
  const pwScript = path.join(__dirname, 'launch-playwright.mjs');
  return new Promise((resolve, reject) => {
    const p = spawn('node', [pwScript], { stdio: 'inherit', cwd: root });
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`launch-playwright exited with code ${code}`));
      else resolve();
    });
  });
}

async function attemptMain() {
  console.log('Building Rover Preview Helper extension...');
  execSync('pnpm build', { stdio: 'inherit', cwd: root });
  
  await downloadExtension('bugbug', 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Doiedehaafceacbnnmindilfblafincjb%26uc', bugbugDir);
  await downloadExtension('cloudqa', 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Djndmknkiojkfghnndgndgmjmhkahiggo%26uc', cloudqaDir);
  
  await startPlaywright();
}

async function main(retries = 2) {
  try {
    await attemptMain();
  } catch (err) {
    console.error(`\n[CRITICAL FAILURE] Multi-Recorder crashed: ${err.message}`);
    if (retries === 0) {
      console.error('[AUTO-HEAL] Out of multi-recorder retries. Aborting entirely.');
      process.exit(1);
    }
    console.log(`[AUTO-HEAL] Wiping local dist and extensions cache for clean retry... (${retries} left)`);
    try {
      await rm(extensionsDir, { recursive: true, force: true });
      await rm(roverExtDir, { recursive: true, force: true });
    } catch(e) {}
    
    await new Promise(r => setTimeout(r, 2000));
    await main(retries - 1);
  }
}

main();
