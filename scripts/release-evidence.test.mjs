import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryBase = path.join(repositoryRoot, 'test-results', 'release-evidence');
const guard = path.join(repositoryRoot, 'scripts', 'release-evidence.ps1');
const sourceCommit = 'a'.repeat(40);
const sourceBranch = 'codex/release-evidence-fixture';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
const requiredGates = readContract('Get-RequiredReleaseGates');
const requiredNativeChecks = readContract('Get-RequiredNativeRuntimeChecks');
const protectedSessionChecks = ['savedStateMatched', 'reopenedStateMatched', 'stateRestored', 'applicationClosed', 'reopened', 'passed'];
const executablePath = 'src-tauri/target/release/randdeck.exe';

function readContract(functionName) {
  const result = runPowerShell(`$ErrorActionPreference = 'Stop'; . ${quotePowerShell(guard)}; @(${functionName}) | ConvertTo-Json -Compress`);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function fixture() {
  mkdirSync(temporaryBase, { recursive: true });
  const root = mkdtempSync(path.join(temporaryBase, 'case-'));
  const write = (relative, bytes) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return hash(readFileSync(target));
  };
  const native = {
    schema: 'zhishutai.tauri-runtime-smoke.v1', passed: true, cleanSource: true, sourceCommit, sessionId: 'c'.repeat(32),
    protectedSession: Object.fromEntries(protectedSessionChecks.map((id) => [id, true])),
    checks: requiredNativeChecks.map((id) => ({ id, status: 'passed' })), consoleErrors: [], ipcErrors: [],
    executablePath, executableSha256: write(executablePath, 'synthetic fixture bytes; never executed'),
  };
  const verification = {
    schema: 'zhishutai.verification.v1', passed: true, version: '0.7.1', sourceCommit, sourceBranch,
    gates: requiredGates.map((id) => ({ id, status: 'passed', exitCode: 0, log: `logs/${id}.log`, sha256: write(`logs/${id}.log`, `synthetic ${id} result\n`) })),
    tauriRuntime: { status: 'passed', sourceCommit, executableSha256: native.executableSha256, report: 'reports/native.json', sha256: '' },
  };
  const saveNative = () => { verification.tauriRuntime.sha256 = write('reports/native.json', JSON.stringify(native)); };
  saveNative();
  return { root, verification, native, write, saveNative };
}

function runGuard(current) {
  current.write('verification.json', JSON.stringify(current.verification));
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `. ${quotePowerShell(guard)}`,
    `$verification = Get-Content -LiteralPath ${quotePowerShell(path.join(current.root, 'verification.json'))} -Raw -Encoding UTF8 | ConvertFrom-Json`,
    `Assert-ReleaseVerification -Root ${quotePowerShell(current.root)} -Verification $verification -Version '0.7.1' -SourceCommit '${sourceCommit}' -SourceBranch '${sourceBranch}'`,
    "Write-Output 'EVIDENCE_ACCEPTED'",
  ].join('; ');
  return runPowerShell(command);
}

function runPowerShell(command) {
  const environment = { ...process.env };
  // Do not inject PowerShell 7 module paths into Windows PowerShell 5.1.
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'psmodulepath') delete environment[key];
  }
  return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true, env: environment,
  });
}

function removeFixture(current) {
  const resolved = path.resolve(current.root);
  assert.ok(resolved.startsWith(`${path.resolve(temporaryBase)}${path.sep}`), 'fixture cleanup stays within its dedicated temporary directory');
  rmSync(resolved, { recursive: true, force: true });
}

test('shared PowerShell release guard accepts complete evidence and rejects incomplete or mismatched evidence', async (t) => {
  const cases = [
    ['complete gate set and matching native executable', () => {}, true],
    ['silent successful gate with a hashed empty log', ({ verification, write }) => {
      const gate = verification.gates.find(({ id }) => id === 'cargo-fmt');
      gate.sha256 = write(gate.log, '');
    }, true],
    ['complete native checks in another order', ({ native, saveNative }) => { native.checks.reverse(); saveNative(); }, true],
    ['metadata with passed:true only', ({ verification }) => { delete verification.gates; delete verification.tauriRuntime; }],
    ['missing gate', ({ verification }) => { verification.gates.pop(); }],
    ['duplicate gate with unchanged gate count', ({ verification }) => { verification.gates[1] = structuredClone(verification.gates[0]); }],
    ['failed gate', ({ verification }) => { verification.gates[0].status = 'failed'; }],
    ['nonzero gate exit code', ({ verification }) => { verification.gates[0].exitCode = 1; }],
    ['missing gate exit code', ({ verification }) => { delete verification.gates[0].exitCode; }],
    ['string gate exit code', ({ verification }) => { verification.gates[0].exitCode = '0'; }],
    ['Boolean gate exit code', ({ verification }) => { verification.gates[0].exitCode = false; }],
    ['array gate status', ({ verification }) => { verification.gates[0].status = ['passed']; }],
    ['stale source commit', ({ verification }) => { verification.sourceCommit = 'b'.repeat(40); }],
    ['stale source branch', ({ verification }) => { verification.sourceBranch = 'another-branch'; }],
    ['tampered gate log', ({ write, verification }) => { write(verification.gates[0].log, 'changed after validation'); }],
    ['missing gate log', ({ root, verification }) => { rmSync(path.join(root, verification.gates[0].log)); }],
    ['missing native evidence', ({ verification }) => { delete verification.tauriRuntime; }],
    ['stale native evidence metadata', ({ verification }) => { verification.tauriRuntime.sourceCommit = 'b'.repeat(40); }],
    ['stale native report content with matching report hash', ({ native, saveNative }) => { native.sourceCommit = 'b'.repeat(40); saveNative(); }],
    ['native report from dirty source', ({ native, saveNative }) => { native.cleanSource = false; saveNative(); }],
    ['native passed is a string rather than a Boolean', ({ native, saveNative }) => { native.passed = 'true'; saveNative(); }],
    ['native cleanSource is a string rather than a Boolean', ({ native, saveNative }) => { native.cleanSource = 'true'; saveNative(); }],
    ['missing native schema', ({ native, saveNative }) => { delete native.schema; saveNative(); }],
    ['unknown native schema', ({ native, saveNative }) => { native.schema = 'zhishutai.tauri-runtime-smoke.v999'; saveNative(); }],
    ['native schema has an array type', ({ native, saveNative }) => { native.schema = [native.schema]; saveNative(); }],
    ['missing protected native session ID', ({ native, saveNative }) => { delete native.sessionId; saveNative(); }],
    ['malformed protected native session ID', ({ native, saveNative }) => { native.sessionId = 'not-a-session'; saveNative(); }],
    ['uppercase protected native session ID', ({ native, saveNative }) => { native.sessionId = 'C'.repeat(32); saveNative(); }],
    ['non-string protected native session ID', ({ native, saveNative }) => { native.sessionId = 7; saveNative(); }],
    ['missing protected native session', ({ native, saveNative }) => { delete native.protectedSession; saveNative(); }],
    ['null protected native session', ({ native, saveNative }) => { native.protectedSession = null; saveNative(); }],
    ['string protected native session', ({ native, saveNative }) => { native.protectedSession = 'passed'; saveNative(); }],
    ['array protected native session', ({ native, saveNative }) => { native.protectedSession = []; saveNative(); }],
    ['empty protected native session', ({ native, saveNative }) => { native.protectedSession = {}; saveNative(); }],
    ...protectedSessionChecks.flatMap((id) => [
      [`missing protected native ${id}`, ({ native, saveNative }) => { delete native.protectedSession[id]; saveNative(); }],
      [`string protected native ${id}`, ({ native, saveNative }) => { native.protectedSession[id] = 'true'; saveNative(); }],
      [`failed protected native ${id} despite runtime passed:true`, ({ native, saveNative }) => { native.protectedSession[id] = false; saveNative(); }],
    ]),
    ['missing native checks', ({ native, saveNative }) => { delete native.checks; saveNative(); }],
    ['null native checks', ({ native, saveNative }) => { native.checks = null; saveNative(); }],
    ['empty native checks', ({ native, saveNative }) => { native.checks = []; saveNative(); }],
    ['scalar native checks', ({ native, saveNative }) => { native.checks = 'passed'; saveNative(); }],
    ['missing native check', ({ native, saveNative }) => { native.checks.pop(); saveNative(); }],
    ['duplicate native check with unchanged count', ({ native, saveNative }) => { native.checks[1] = structuredClone(native.checks[0]); saveNative(); }],
    ['unknown native check with unchanged count', ({ native, saveNative }) => { native.checks[0].id = 'unknown-native-check'; saveNative(); }],
    ['extra unknown native check', ({ native, saveNative }) => { native.checks.push({ id: 'unknown-native-check', status: 'passed' }); saveNative(); }],
    ['null native check row', ({ native, saveNative }) => { native.checks[0] = null; saveNative(); }],
    ['failed native check despite passed:true', ({ native, saveNative }) => { native.checks[0].status = 'failed'; saveNative(); }],
    ['running native check despite passed:true', ({ native, saveNative }) => { native.checks[0].status = 'running'; saveNative(); }],
    ['missing native check status', ({ native, saveNative }) => { delete native.checks[0].status; saveNative(); }],
    ['array native check status', ({ native, saveNative }) => { native.checks[0].status = ['passed']; saveNative(); }],
    ['native check carries an error despite passed status', ({ native, saveNative }) => { native.checks[0].error = 'recorded fixture failure'; saveNative(); }],
    ['native console errors', ({ native, saveNative }) => { native.consoleErrors = ['uncaught fixture failure']; saveNative(); }],
    ['missing native console errors', ({ native, saveNative }) => { delete native.consoleErrors; saveNative(); }],
    ['null native console errors', ({ native, saveNative }) => { native.consoleErrors = null; saveNative(); }],
    ['string native console errors', ({ native, saveNative }) => { native.consoleErrors = ''; saveNative(); }],
    ['object native console errors', ({ native, saveNative }) => { native.consoleErrors = {}; saveNative(); }],
    ['native IPC errors', ({ native, saveNative }) => { native.ipcErrors = [{ command: 'plugin:store|save', error: 'fixture denied' }]; saveNative(); }],
    ['missing native IPC errors', ({ native, saveNative }) => { delete native.ipcErrors; saveNative(); }],
    ['null native IPC errors', ({ native, saveNative }) => { native.ipcErrors = null; saveNative(); }],
    ['string native IPC errors', ({ native, saveNative }) => { native.ipcErrors = ''; saveNative(); }],
    ['object native IPC errors', ({ native, saveNative }) => { native.ipcErrors = {}; saveNative(); }],
    ['Boolean native IPC errors', ({ native, saveNative }) => { native.ipcErrors = false; saveNative(); }],
    ['empty native report', ({ native, saveNative }) => { Object.keys(native).forEach((key) => delete native[key]); saveNative(); }],
    ['native report hash mismatch', ({ verification }) => { verification.tauriRuntime.sha256 = '0'.repeat(64); }],
    ['native executable hash mismatch', ({ write }) => { write(executablePath, 'tampered executable fixture'); }],
    ['missing native executable', ({ root }) => { rmSync(path.join(root, executablePath)); }],
    ['native executable metadata hash mismatch', ({ verification }) => { verification.tauriRuntime.executableSha256 = '0'.repeat(64); }],
    ['evidence for another existing executable', ({ native, verification, write, saveNative }) => {
      native.executablePath = 'bin/other.exe';
      native.executableSha256 = write(native.executablePath, 'synthetic other executable');
      verification.tauriRuntime.executableSha256 = native.executableSha256;
      saveNative();
    }],
    ['gate evidence escaping the repository root', ({ verification }) => { verification.gates[0].log = '../outside.log'; }],
  ];
  for (const [name, mutate, accepted = false] of cases) {
    await t.test(name, () => {
      const current = fixture();
      try {
        mutate(current);
        const result = runGuard(current);
        assert.ifError(result.error);
        const output = `${result.stdout}\n${result.stderr}`;
        if (accepted) {
          assert.equal(result.status, 0, output);
          assert.match(result.stdout, /EVIDENCE_ACCEPTED/);
        } else {
          assert.notEqual(result.status, 0, `guard accepted invalid evidence: ${name}\n${output}`);
          assert.doesNotMatch(result.stdout, /EVIDENCE_ACCEPTED/);
        }
      } finally {
        removeFixture(current);
      }
    });
  }
});

test('native release contract exactly matches the checks executed by the desktop smoke runner', () => {
  const smokeSource = readFileSync(path.join(repositoryRoot, 'scripts', 'tauri-runtime-smoke.mjs'), 'utf8');
  const actual = [...smokeSource.matchAll(/await check\("([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(actual).size, actual.length, 'native smoke check IDs must be unique');
  assert.deepEqual([...requiredNativeChecks].sort(), [...actual].sort());
});

test('release gate contract exactly matches the commands executed by verify-release', () => {
  const runner = readFileSync(path.join(repositoryRoot, 'scripts', 'verify-release.ps1'), 'utf8');
  const actual = [...runner.matchAll(/@\{ id = "([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(actual).size, actual.length, 'release gate IDs must be unique');
  assert.deepEqual([...requiredGates].sort(), [...actual].sort());
});

test('upload checksum generation uses finalized local bytes and rejects stale artifact declarations', () => {
  const current = fixture();
  try {
    const artifact = (relative, fileName, bytes, kind) => ({
      kind, path: relative, fileName, bytes: Buffer.byteLength(bytes), sha256: current.write(relative, bytes),
    });
    const manifest = {
      schema: 'zhishutai.release.v2', version: '0.7.1',
      dependencies: { report: artifact('dependencies-licenses.json', 'dependencies-licenses.json', '{"synthetic":true}', 'dependency-license-report') },
      artifacts: [
        artifact('portable/RandDeck.exe', 'RandDeck.exe', 'synthetic portable', 'portable'),
        artifact('installer/RandDeck-v0.7.1-offline-setup.exe', 'RandDeck-v0.7.1-offline-setup.exe', 'synthetic installer', 'nsis-offline-installer'),
        artifact('RandDeck-v0.7.1-portable.zip', 'RandDeck-v0.7.1-portable.zip', 'synthetic zip', 'portable-package-zip'),
      ],
    };
    const checksumScript = path.join(repositoryRoot, 'scripts', 'write-release-checksums.ps1');
    const runChecksums = () => runPowerShell(`$ErrorActionPreference = 'Stop'; & ${quotePowerShell(checksumScript)} -Version '0.7.1' -ReleaseRoot ${quotePowerShell(current.root)}`);
    current.write('manifest.json', JSON.stringify(manifest));
    const first = runChecksums();
    assert.ifError(first.error);
    assert.equal(first.status, 0, first.stderr);
    const firstLines = readFileSync(path.join(current.root, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
    assert.equal(firstLines.length, 5);
    assert.ok(firstLines.includes(`${hash(readFileSync(path.join(current.root, 'manifest.json')))}  manifest.json`));
    for (const item of [...manifest.artifacts, manifest.dependencies.report]) {
      assert.ok(firstLines.includes(`${item.sha256}  ${item.fileName}`));
    }
    manifest.finalizedAt = '2026-10-25T00:00:00.000Z';
    current.write('manifest.json', JSON.stringify(manifest));
    const finalized = runChecksums();
    assert.equal(finalized.status, 0, finalized.stderr);
    const finalizedText = readFileSync(path.join(current.root, 'SHA256SUMS.txt'), 'utf8');
    assert.ok(finalizedText.includes(`${hash(readFileSync(path.join(current.root, 'manifest.json')))}  manifest.json`));
    assert.notEqual(finalizedText.trim(), firstLines.join('\n'));
    current.write('portable/RandDeck.exe', 'tampered portable bytes');
    const tampered = runChecksums();
    assert.notEqual(tampered.status, 0, 'checksum generation must reject artifacts that disagree with the manifest');
  } finally {
    removeFixture(current);
  }
});

test('portable packaging includes the promised dependency license report and verifies archive entries', () => {
  const current = fixture();
  try {
    for (const script of ['package-portable.ps1', 'write-release-checksums.ps1']) {
      current.write(`scripts/${script}`, readFileSync(path.join(repositoryRoot, 'scripts', script)));
    }
    for (const name of ['README.md', 'README.zh-CN.md', 'LICENSE']) current.write(name, `synthetic ${name}\n`);
    const releasePrefix = 'releases/0.7.1';
    const executable = 'synthetic portable executable; never executed';
    const dependencies = '{"syntheticDependencyLicenses":true}';
    const executableHash = current.write(`${releasePrefix}/portable/RandDeck.exe`, executable);
    const dependencyHash = current.write(`${releasePrefix}/dependencies-licenses.json`, dependencies);
    current.write(`${releasePrefix}/manifest.json`, JSON.stringify({
      schema: 'zhishutai.release.v2', version: '0.7.1',
      dependencies: { report: { path: 'dependencies-licenses.json', fileName: 'dependencies-licenses.json', bytes: Buffer.byteLength(dependencies), sha256: dependencyHash } },
      artifacts: [{ kind: 'portable', path: 'portable/RandDeck.exe', fileName: 'RandDeck.exe', bytes: Buffer.byteLength(executable), sha256: executableHash }],
    }));
    const archivePath = path.join(current.root, releasePrefix, 'RandDeck-v0.7.1-portable.zip');
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `& ${quotePowerShell(path.join(current.root, 'scripts', 'package-portable.ps1'))} -Version '0.7.1' | Out-Null`,
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$zip = [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShell(archivePath)})`,
      'try { @($zip.Entries | ForEach-Object FullName) | ConvertTo-Json -Compress } finally { $zip.Dispose() }',
    ].join('; ');
    const result = runPowerShell(command);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).sort(), [
      'RandDeck.exe', 'README.md', 'README.zh-CN.md', 'LICENSE.txt',
      'dependencies-licenses.json', 'manifest.json', 'SHA256SUMS.txt',
    ].sort());
    assert.equal(readFileSync(path.join(current.root, releasePrefix, 'portable-package', 'dependencies-licenses.json'), 'utf8'), dependencies);
    const checksumText = readFileSync(path.join(current.root, releasePrefix, 'SHA256SUMS.txt'), 'utf8');
    assert.ok(checksumText.includes(`${hash(readFileSync(path.join(current.root, releasePrefix, 'manifest.json')))}  manifest.json`));
    assert.ok(checksumText.includes(`${hash(readFileSync(archivePath))}  RandDeck-v0.7.1-portable.zip`));
  } finally {
    removeFixture(current);
  }
});
