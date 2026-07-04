import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extensionsDir = path.join(root, 'extensions');
const bugbugDir = path.join(extensionsDir, 'bugbug');
const sbaseExtDir = path.join(extensionsDir, 'sbase-recorder');
const roverExtDir = path.join(root, 'dist');

async function downloadBugbug() {
  if (existsSync(bugbugDir)) {
    console.log('Bugbug extension already downloaded.');
    return;
  }
  console.log('Downloading Bugbug extension...');
  await mkdir(extensionsDir, { recursive: true });
  const crxUrl = 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Doiedehaafceacbnnmindilfblafincjb%26uc';
  
  const response = await fetch(crxUrl);
  if (!response.ok) throw new Error(`Failed to download Bugbug: ${response.statusText}`);
  
  const buffer = await response.arrayBuffer();
  let crxBuffer = Buffer.from(buffer);

  // Strip CRX2/CRX3 headers to get the raw ZIP payload
  const magic = crxBuffer.readUInt32LE(0);
  if (magic === 0x34327243) { // 'Cr24'
    const version = crxBuffer.readUInt32LE(4);
    if (version === 2) {
      const publicKeyLength = crxBuffer.readUInt32LE(8);
      const signatureLength = crxBuffer.readUInt32LE(12);
      crxBuffer = crxBuffer.slice(16 + publicKeyLength + signatureLength);
    } else if (version === 3) {
      const headerSize = crxBuffer.readUInt32LE(8);
      crxBuffer = crxBuffer.slice(12 + headerSize);
    } else {
      throw new Error(`Unsupported CRX version: ${version}`);
    }
  }

  const zipPath = path.join(extensionsDir, 'bugbug.zip');
  await writeFile(zipPath, crxBuffer);
  
  console.log('Extracting Bugbug extension...');
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(bugbugDir, true);
  console.log('Bugbug extension ready.');
}


async function startPlaywright() {
  console.log('Launching browser with all extensions...');
  const pwScript = path.join(__dirname, 'launch-playwright.mjs');
  spawn('node', [pwScript], { stdio: 'inherit', cwd: root });
}

async function main() {
  console.log('Building Rover Preview Helper extension...');
  execSync('pnpm build', { stdio: 'inherit', cwd: root });
  
  await downloadBugbug();
  
  await startPlaywright();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
