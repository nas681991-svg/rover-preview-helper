const EXTENSION_SOURCES = [
  {
    id: 'bugbug',
    name: 'Bugbug',
    url: 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Doiedehaafceacbnnmindilfblafincjb%26uc',
    isCrx: true,
  },
  {
    id: 'cloudqa',
    name: 'CloudQA',
    url: 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Djndmknkiojkfghnndgndgmjmhkahiggo%26uc',
    isCrx: true,
  },
  {
    id: 'fillapp',
    name: 'FillApp',
    url: 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Dfillapp_placeholder_id%26uc',
    isCrx: true,
  }
];

/**
 * Resolves the launch plan for the given mode.
 * @param {string} mode - The launch mode (e.g. 'all', 'rover', 'bugbug', 'form-recorder', 'seleniumbase', 'playwright-trace').
 * @param {object} env - The environment context { extDataDir, bugbugDir, sbaseExtDir, fillappDir, cloudqaDir, roverExtDir, devDist, existsSync, pathJoin }.
 * @returns {object} plan - { targetSources: Array, extensions: Array, error: string|null }
 */
function resolveLaunchPlan(mode, env) {
  const plan = {
    targetSources: [],
    extensions: [],
    error: null
  };

  // Determine what needs to be downloaded/updated
  if (mode === 'bugbug' || mode === 'all') {
    const bugbugSource = EXTENSION_SOURCES.find(e => e.id === 'bugbug');
    plan.targetSources.push({
      ...bugbugSource,
      destZip: env.pathJoin(env.extDataDir, 'bugbug.crx'),
      extractDir: env.bugbugDir
    });
  }
  // (Other sources like cloudqa/fillapp are out of scope for auto-download based on current logic, but could be added here later)

  // Determine which extensions should be loaded
  if (mode === 'all') {
    plan.extensions.push({ id: 'rover', dir: env.roverExtDir });
    plan.extensions.push({ id: 'bugbug', dir: env.bugbugDir });
    plan.extensions.push({ id: 'seleniumbase', dir: env.sbaseExtDir });
    plan.extensions.push({ id: 'fillapp', dir: env.fillappDir });
    plan.extensions.push({ id: 'cloudqa', dir: env.cloudqaDir });
  } else if (mode === 'rover') {
    plan.extensions = [{ id: 'rover', dir: env.roverExtDir }];
  } else if (mode === 'form-recorder') {
    const dir = env.existsSync(env.devDist) ? env.devDist : env.roverExtDir;
    plan.extensions = [{ id: 'form-recorder', dir }];
  } else if (mode === 'bugbug') {
    plan.extensions = [{ id: 'bugbug', dir: env.bugbugDir }];
  } else if (mode === 'seleniumbase') {
    plan.extensions = [{ id: 'seleniumbase', dir: env.sbaseExtDir }];
  } else if (mode === 'playwright-trace') {
    plan.extensions = [];
  } else {
    plan.error = `Unknown mode: ${mode}`;
  }

  return plan;
}

/**
 * Downloads and extracts an extension CRX/ZIP.
 * @param {object} source - The source config object.
 * @param {object} sys - The system dependencies { fetch, mkdirSync, writeFileSync, renameSync, existsSync, pathDirname, AdmZip, Buffer }.
 */
async function acquireExtension(source, sys) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await sys.fetch(source.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Failed to download from ${source.url}`);
    
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Received HTML instead of extension archive`);
    }

    const arrayBuffer = await response.arrayBuffer();
    let zipBuffer = sys.Buffer.from(arrayBuffer);

    if (zipBuffer.length === 0) {
      throw new Error(`Empty response from ${source.url}`);
    }

    if (source.isCrx) {
      const magic = zipBuffer.readUInt32LE(0);
      if (magic === 0x34327243) { // 'Cr24'
        const version = zipBuffer.readUInt32LE(4);
        if (version === 2) {
          const publicKeyLength = zipBuffer.readUInt32LE(8);
          const signatureLength = zipBuffer.readUInt32LE(12);
          zipBuffer = zipBuffer.subarray(16 + publicKeyLength + signatureLength);
        } else if (version === 3) {
          const headerSize = zipBuffer.readUInt32LE(8);
          zipBuffer = zipBuffer.subarray(12 + headerSize);
        } else {
          throw new Error(`Unsupported CRX version: ${version}`);
        }
      }
    }

    sys.mkdirSync(sys.pathDirname(source.destZip), { recursive: true });
    const tempDestZip = `${source.destZip}.tmp.${Date.now()}`;
    sys.writeFileSync(tempDestZip, zipBuffer);
    sys.renameSync(tempDestZip, source.destZip);

    const zip = new sys.AdmZip(source.destZip);
    await new Promise((resolve, reject) => {
      zip.extractAllToAsync(source.extractDir, true, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    if (!sys.existsSync(source.extractDir + '/manifest.json') && !sys.existsSync(source.extractDir + '\\manifest.json')) {
      throw new Error(`Invalid extension: manifest.json not found in extracted archive`);
    }

  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  EXTENSION_SOURCES,
  resolveLaunchPlan,
  acquireExtension
};
