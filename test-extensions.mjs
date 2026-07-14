import { chromium } from 'patchright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname);
const bugbugDir = path.join(root, 'extensions', 'bugbug');
const roverExtDir = path.join(root, 'app-assets', 'rover');
const sbaseExtDir = path.join(root, 'app-assets', 'sbase-recorder');

const extensions = [bugbugDir, roverExtDir, sbaseExtDir].filter(existsSync);
const extensionsStr = extensions.join(',');

async function runTest(argsToTest, channel = undefined) {
    const userDataDir = path.join(root, `.playwright-test-${Date.now()}`);
    mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
    writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify({
        extensions: { ui: { developer_mode: true } }
    }));

    console.log(`\nTesting with channel: ${channel || 'bundled'}, args:`, argsToTest);
    
    let context;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            channel,
            headless: false,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
                `--disable-extensions-except=${extensionsStr}`,
                `--load-extension=${extensionsStr}`,
                ...argsToTest
            ]
        });

        const page = context.pages()[0] || await context.newPage();
        await page.goto('chrome://extensions/');
        await page.bringToFront();
        await page.waitForTimeout(3000); // let it render

        const cdp = await context.newCDPSession(page);
        const { targetInfos } = await cdp.send('Target.getTargets');
        const extTargets = targetInfos.filter(t => t.url.startsWith('chrome-extension://') && !t.url.includes('Hangouts'));
        
        console.log(`Loaded ${extTargets.length} extensions.`);
        extTargets.forEach(t => console.log(` - ${t.title || t.url}`));

        // Take a screenshot
        await page.screenshot({ path: path.join(root, 'extensions_page.png') });
        console.log(`Saved screenshot to extensions_page.png`);

        await context.close();
        
        if (extTargets.length >= 3) {
            console.log('SUCCESS! ALL EXTENSIONS LOADED!');
            return true;
        } else {
            console.log('FAILED to load all extensions.');
            return false;
        }
    } catch (e) {
        console.error('Launch failed:', e.message);
        if (context) await context.close().catch(() => {});
        return false;
    }
}

async function loop() {
    const configurations = [
        { channel: undefined, args: [
            '--disable-blink-features=AutomationControlled',
            '--enable-extensions',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars'
        ] }
    ];

    for (const config of configurations) {
        const success = await runTest(config.args, config.channel);
        if (success) {
            console.log('FOUND WORKING CONFIGURATION!');
            process.exit(0);
        }
    }
    console.log('NO CONFIGURATION WORKED.');
}

loop();
