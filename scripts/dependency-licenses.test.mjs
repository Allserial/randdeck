import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { generateNpmLicenseReport } from './dependency-licenses.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryBase = path.join(repositoryRoot, 'test-results', 'dependency-licenses');
const generator = path.join(repositoryRoot, 'scripts', 'dependency-licenses.mjs');

function fixture() {
  mkdirSync(temporaryBase, { recursive: true });
  const root = mkdtempSync(path.join(temporaryBase, 'case-'));
  const packageJson = { name: 'fixture', version: '1.0.0', dependencies: { '@scope/app': '^1.0.0' }, devDependencies: { tool: '^2.0.0' } };
  const lockfile = {
    name: packageJson.name, version: packageJson.version, lockfileVersion: 3,
    packages: {
      '': structuredClone(packageJson),
      'node_modules/@scope/app': { version: '1.0.0', license: 'MIT' },
      'node_modules/scheduler': { version: '0.27.0', license: 'MIT' },
      'node_modules/@scope/app/node_modules/scheduler': { version: '0.26.0', license: 'MIT' },
      'node_modules/tool': { version: '2.0.0', license: 'Apache-2.0', dev: true },
      'node_modules/@native/linux': { version: '1.0.0', license: 'MIT', dev: true, optional: true, os: ['linux'], cpu: ['arm64'], libc: ['musl'] },
    },
  };
  const write = (relative, value) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  };
  const save = () => { write('package.json', packageJson); write('package-lock.json', lockfile); };
  save();
  for (const [lockPath, metadata] of Object.entries(lockfile.packages)) {
    if (!lockPath || metadata.optional) continue;
    write(`${lockPath}/package.json`, { name: lockPath.split('node_modules/').at(-1), version: metadata.version, license: metadata.license });
  }
  return { root, packageJson, lockfile, write, save };
}

function withFixture(action) {
  const current = fixture();
  try { return action(current); }
  finally {
    assert.ok(path.resolve(current.root).startsWith(`${path.resolve(temporaryBase)}${path.sep}`));
    rmSync(current.root, { recursive: true, force: true });
  }
}

test('inventory includes transitive scheduler, scoped names, nested duplicate versions and uninstalled optional platforms', () => withFixture(({ root }) => {
  const report = generateNpmLicenseReport({ root });
  assert.equal(report.npmDirect.length, 2);
  assert.equal(report.npmResolved.length, 5);
  assert.deepEqual(report.npmResolved.filter(({ name }) => name === 'scheduler').map(({ version }) => version), ['0.26.0', '0.27.0']);
  assert.equal(report.npmResolved.find(({ name }) => name === 'scheduler').direct, false);
  const optional = report.npmResolved.find(({ name }) => name === '@native/linux');
  assert.deepEqual(optional.platform, { os: ['linux'], cpu: ['arm64'], libc: ['musl'] });
  assert.equal(optional.installed, false);
  assert.equal(optional.optional, true);
  assert.equal(optional.development, true);
  assert.ok(report.npmResolved.every(({ licenseSource }) => licenseSource === 'package-lock.json'));
  assert.equal(report.npmScope.inventory, 'all-package-lock-resolved-locations');
  assert.equal(report.npmScope.duplicatePolicy, 'preserve-each-lockfile-location-and-version');
  assert.match(report.npmLockfile.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.npmDirect[1], { name: 'tool', version: '2.0.0', license: 'Apache-2.0', development: true, declaredName: 'tool', lockPath: 'node_modules/tool', declarations: ['devDependencies'] });
}));

test('inventory order is stable across lockfile entry ordering', () => withFixture((current) => {
  const before = generateNpmLicenseReport({ root: current.root });
  current.lockfile.packages = Object.fromEntries(Object.entries(current.lockfile.packages).reverse());
  current.save();
  const after = generateNpmLicenseReport({ root: current.root });
  assert.deepEqual(after.npmResolved, before.npmResolved);
  assert.deepEqual(after.npmDirect, before.npmDirect);
  assert.notEqual(after.npmLockfile.sha256, before.npmLockfile.sha256);
}));

test('npm aliases retain the installed package name and declared direct dependency name', () => withFixture((current) => {
  current.packageJson.dependencies.alias = 'npm:real-package@1.0.0';
  current.lockfile.packages[''].dependencies.alias = 'npm:real-package@1.0.0';
  current.lockfile.packages['node_modules/alias'] = { name: 'real-package', version: '1.0.0', license: 'MIT' };
  current.write('node_modules/alias/package.json', { name: 'real-package', version: '1.0.0', license: 'MIT' });
  current.save();
  const alias = generateNpmLicenseReport({ root: current.root }).npmDirect.find(({ declaredName }) => declaredName === 'alias');
  assert.equal(alias.name, 'real-package');
  assert.equal(alias.lockPath, 'node_modules/alias');
}));

test('development-optional flag is preserved independently from exclusive development dependencies', () => withFixture((current) => {
  current.lockfile.packages['node_modules/scheduler'].devOptional = true;
  current.save();
  const scheduler = generateNpmLicenseReport({ root: current.root }).npmResolved.find(({ lockPath }) => lockPath === 'node_modules/scheduler');
  assert.equal(scheduler.developmentOptional, true);
  assert.equal(scheduler.development, false);
}));

const rejectedCases = [
  ['root version mismatch', ({ packageJson }) => { packageJson.version = '2.0.0'; }, /different root packages/],
  ['root declarations mismatch', ({ packageJson }) => { packageJson.dependencies['@scope/app'] = '^2.0.0'; }, /disagree on dependencies/],
  ['direct dependency omitted from the lockfile', ({ lockfile }) => { delete lockfile.packages['node_modules/@scope/app']; }, /Direct dependency is absent/],
  ['missing locked license even when installed metadata contains one', ({ lockfile }) => { delete lockfile.packages['node_modules/scheduler'].license; }, /license metadata/],
  ['empty locked license', ({ lockfile }) => { lockfile.packages['node_modules/scheduler'].license = ' '; }, /license metadata/],
  ['structured rather than string license', ({ lockfile }) => { lockfile.packages['node_modules/scheduler'].license = { type: 'MIT' }; }, /license metadata/],
  ['missing optional package license', ({ lockfile }) => { delete lockfile.packages['node_modules/@native/linux'].license; }, /license metadata/],
  ['missing installed license', ({ write }) => { write('node_modules/scheduler/package.json', { name: 'scheduler', version: '0.27.0' }); }, /license metadata/],
  ['installed license differs from the lockfile', ({ write }) => { write('node_modules/scheduler/package.json', { name: 'scheduler', version: '0.27.0', license: 'GPL-3.0-only' }); }, /license conflicts/],
  ['installed version differs from the lockfile', ({ write }) => { write('node_modules/scheduler/package.json', { name: 'scheduler', version: '0.99.0', license: 'MIT' }); }, /name\/version conflicts/],
  ['installed name differs from the lockfile', ({ write }) => { write('node_modules/scheduler/package.json', { name: 'different-package', version: '0.27.0', license: 'MIT' }); }, /name\/version conflicts/],
  ['missing required installed package', ({ root }) => { rmSync(path.join(root, 'node_modules/scheduler/package.json')); }, /ENOENT/],
  ['malformed installed optional package metadata', ({ write }) => { write('node_modules/@native/linux/package.json', '{invalid'); }, /JSON|Expected/],
  ['linked package cannot be silently omitted', ({ lockfile }) => { lockfile.packages['node_modules/scheduler'].link = true; }, /Unsupported linked/],
  ['lockfile path traversal', ({ lockfile }) => { lockfile.packages['node_modules/../escaped'] = { version: '1.0.0', license: 'MIT' }; }, /unsafe lockfile package path/],
  ['lockfile parent segment cannot resolve the root package', ({ lockfile }) => { lockfile.packages['node_modules/..'] = { version: '1.0.0', license: 'MIT' }; }, /unsafe lockfile package path/],
  ['missing locked version', ({ lockfile }) => { delete lockfile.packages['node_modules/scheduler'].version; }, /name\/version/],
  ['malformed platform constraint', ({ lockfile }) => { lockfile.packages['node_modules/@native/linux'].os = 'linux'; }, /Invalid os/],
  ['legacy lockfile without a complete package map', ({ lockfile }) => { lockfile.lockfileVersion = 1; }, /v2\/v3 packages inventory/],
];

for (const [name, mutate, expected] of rejectedCases) {
  test(`fails closed for ${name}`, () => withFixture((current) => {
    mutate(current);
    current.save();
    assert.throws(() => generateNpmLicenseReport({ root: current.root }), expected);
  }));
}

test('CLI reports a failure with nonzero exit and no partial JSON output', () => withFixture((current) => {
  delete current.lockfile.packages['node_modules/scheduler'].license;
  current.save();
  const result = spawnSync(process.execPath, [generator, '--root', current.root], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Dependency license inventory failed:.*license metadata/);
}));

test('current project inventory covers exactly all locked package locations, including scheduler@0.27.0', () => {
  const report = generateNpmLicenseReport({ root: repositoryRoot });
  const lockfile = JSON.parse(readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  assert.deepEqual(report.npmResolved.map(({ lockPath }) => lockPath).sort(), Object.keys(lockfile.packages).filter(Boolean).sort());
  assert.ok(report.npmResolved.some(({ name, version, direct, license }) => name === 'scheduler' && version === '0.27.0' && !direct && license === 'MIT'));
  assert.ok(report.npmResolved.length > report.npmDirect.length);
});
