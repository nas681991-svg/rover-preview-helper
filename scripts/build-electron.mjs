import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'app-assets');
const bugbugDir = path.join(assetsDir, 'bugbug');
const sbaseExtDir = path.join(assetsDir, 'sbase-recorder');
const roverExtDir = path.join(assetsDir, 'rover');

async function downloadBugbug() {
  if (existsSync(bugbugDir)) {
    console.log('Bugbug extension already downloaded.');
    return;
  }
  console.log('Downloading Bugbug extension...');
  await mkdir(assetsDir, { recursive: true });
  const crxUrl = 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Doiedehaafceacbnnmindilfblafincjb%26uc';
  const controller = new AbortController();
  const downloadTimeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(crxUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to download Bugbug: ${response.statusText}`);
  
    const buffer = await response.arrayBuffer();
    let crxBuffer = Buffer.from(buffer);
  
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

    const zipPath = path.join(assetsDir, 'bugbug.zip');
    await writeFile(zipPath, crxBuffer);
  
    console.log('Extracting Bugbug extension...');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(bugbugDir, true);
    console.log('Bugbug extension ready.');
  } finally {
    clearTimeout(downloadTimeout);
  }
}


async function main() {
  console.log('Cleaning app-assets...');
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  console.log('Building Rover Preview Helper extension...');
  execSync('npm run build', { stdio: 'inherit', cwd: root });
  
  await cp(path.join(root, 'dist'), roverExtDir, { recursive: true });
  
  await downloadBugbug();
  
  console.log('Building Electron app...');
  execSync('npx electron-builder', { stdio: 'inherit', cwd: root });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
