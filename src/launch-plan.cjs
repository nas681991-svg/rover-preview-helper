const EXTENSION_SOURCES = [
  {
    id: 'bugbug',
    name: 'Bugbug',
    url: 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=99.0&acceptformat=crx2,crx3&x=id%3Doiedehaafceacbnnmindilfblafincjb%26uc',
    isCrx: true,
  },

];

/**
 * Resolves the launch plan for the given mode.
 * @param {string} mode - The launch mode (e.g. 'all', 'rover', 'bugbug', 'form-recorder', 'seleniumbase', 'cloudqa', 'playwright-trace').
 * @param {object} env - The environment context { extDataDir, bugbugDir, sbaseExtDir, roverExtDir, devDist, existsSync, pathJoin }.
 * @returns {object} plan - { targetSources: Array, extensions: Array, error: string|null }
 */
function resolveLaunchPlan(mode, env) {
  const plan = {
    targetSources: [],
    extensions: [],
    startUrl: '',
    warnings: [],
    missingRequired: [],
    needsMcp: false,
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



  // Determine which extensions should be loaded
  const toLoad = [];
  if (mode === 'all') {
    toLoad.push({ id: 'rover', dir: env.roverExtDir });
    toLoad.push({ id: 'bugbug', dir: env.bugbugDir });
    toLoad.push({ id: 'seleniumbase', dir: env.sbaseExtDir });

  } else if (mode === 'rover') {
    toLoad.push({ id: 'rover', dir: env.roverExtDir });
  } else if (mode === 'form-recorder') {
    const dir = env.existsSync(env.devDist) ? env.devDist : env.roverExtDir;
    toLoad.push({ id: 'form-recorder', dir });
  } else if (mode === 'bugbug') {
    toLoad.push({ id: 'bugbug', dir: env.bugbugDir });
  } else if (mode === 'seleniumbase') {
    toLoad.push({ id: 'seleniumbase', dir: env.sbaseExtDir });

  } else if (mode === 'playwright-trace') {
    // nothing to load
  } else {
    plan.error = `Unknown mode: ${mode}`;
  }

  // Validate presence and categorize
  for (const ext of toLoad) {
    const isDownloadable = plan.targetSources.some(ts => ts.id === ext.id);
    if (isDownloadable || env.existsSync(ext.dir)) {
      plan.extensions.push(ext);
    } else {
      if (mode === 'all' && ext.id !== 'rover') {
        plan.warnings.push(`Extension '${ext.id}' is unavailable at ${ext.dir}.`);
      } else {
        plan.missingRequired.push(ext.id);
      }
    }
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

    const manifestPath = sys.pathJoin ? sys.pathJoin(source.extractDir, 'manifest.json') : source.extractDir + '/manifest.json';
    if (!sys.existsSync(manifestPath)) {
      throw new Error(`Invalid extension: manifest.json not found in extracted archive`);
    }

    const manifestContent = sys.readFileSync ? sys.readFileSync(manifestPath, 'utf-8') : sys.readFileSyncFallback(manifestPath);
    let manifest;
    try {
      manifest = JSON.parse(manifestContent);
    } catch (e) {
      throw new Error(`Invalid extension: manifest.json is not valid JSON`);
    }

    const hasBackground = manifest.background?.service_worker || manifest.background?.scripts;
    const hasContentScripts = manifest.content_scripts && manifest.content_scripts.length > 0;
    const hasPopup = manifest.action?.default_popup || manifest.browser_action?.default_popup;
    
    if (!hasBackground && !hasContentScripts && !hasPopup) {
      throw new Error(`Invalid extension: no entrypoints found in manifest`);
    }

    const metaPath = sys.pathJoin ? sys.pathJoin(source.extractDir, '..', `${source.id}_meta.json`) : source.extractDir + '_meta.json';
    const metadata = {
      id: source.id,
      name: source.name,
      url: source.url,
      manifestVersion: manifest.manifest_version,
      downloadedAt: new Date().toISOString(),
      sourceType: source.isCrx ? 'crx' : 'zip'
    };
    if (sys.writeFileSync) {
      sys.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
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
