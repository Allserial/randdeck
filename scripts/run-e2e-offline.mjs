// Exercise the production build without opening a TCP listener. The original
// test assertions are preserved; only their browser transport is substituted.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const build = join(root, 'dist');
readFileSync(join(build, 'index.html'));
const run = join(root, 'reports', 'e2e-offline', new Date().toISOString().replaceAll(':', '-'));
const tests = join(run, 'e2e');
mkdirSync(tests, { recursive: true });
const source = `
import {test as base} from '@playwright/test';
export * from '@playwright/test';
import fs from 'node:fs'; import path from 'node:path';
const root = ${JSON.stringify(build)};
async function bind(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404, body:'missing'});
    return route.fulfill({contentType:({'.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream'), body:fs.readFileSync(file)});
  });
}
export const test = base.extend({
  auditTransport: [async ({browser}, use) => {
    const original = browser.newContext.bind(browser);
    browser.newContext = async (...args) => { const context = await original(...args); await bind(context); return context; };
    try { await use(); } finally { browser.newContext = original; }
  }, {auto:true}],
  context: async ({context}, use) => { await bind(context); await use(context); },
});
`;
writeFileSync(join(tests, 'offline-fixture.ts'), source);
for (const name of readdirSync(join(root, 'e2e')).filter(name => name.endsWith('.spec.ts'))) {
  const original = readFileSync(join(root, 'e2e', name), 'utf8');
  const copy = original
    .replace(/from (["'])@playwright\/test\1/g, 'from "./offline-fixture"')
    .replace(/from (["'])\.\.\/src\/([^"']+)\1/g, (_match, _quote, path) => `from ${JSON.stringify(join(root, 'src', path).replaceAll('\\', '/'))}`);
  writeFileSync(join(tests, name), copy);
}
writeFileSync(join(run, 'playwright.config.ts'), `
import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', outputDir:'./results', timeout:45000, expect:{timeout:8000}, workers:1, retries:0,
  reporter:[['list'], ['json',{outputFile:'./result.json'}]],
  use:{baseURL:'http://127.0.0.1:41999', locale:'zh-CN', colorScheme:'dark', viewport:{width:1180,height:820}, headless:true, screenshot:'only-on-failure', trace:'retain-on-failure'},
});
`);
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', join(run, 'playwright.config.ts')], {
  cwd: run, stdio: 'inherit', env: {
    ...process.env, NODE_PATH: join(root, 'node_modules'), TEMP: run, TMP: run,
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  },
});
writeFileSync(join(root, 'reports', 'e2e-offline', 'latest.json'), JSON.stringify({
  productionBuild: 'dist', run: run.slice(root.length + 1), result: join(run, 'result.json').slice(root.length + 1),
  exitCode: result.status, transport: 'intercepted production assets; no server; all original assertions preserved',
}, null, 2));
if (result.error) throw result.error;
process.exit(result.status ?? 1);
