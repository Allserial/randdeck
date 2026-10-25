import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directSections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const packageNamePattern = '(?:@[a-z0-9._~-]+/)?[a-z0-9._~-]+';
const lockPathPattern = new RegExp(`^(?:node_modules/${packageNamePattern})(?:/node_modules/${packageNamePattern})*$`, 'i');

function readJson(target) {
  return JSON.parse(readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
}

function requireLicense(value, location) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing or invalid license metadata: ${location}`);
  }
  return value.trim();
}

function orderedDeclarations(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Dependency declarations must be an object.');
  }
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compare(left, right)));
}

/** Inventory every resolved lockfile location, including nested duplicates and absent optional platforms. */
export function generateNpmLicenseReport({ root }) {
  const repositoryRoot = path.resolve(root);
  const packageJson = readJson(path.join(repositoryRoot, 'package.json'));
  const lockfileBytes = readFileSync(path.join(repositoryRoot, 'package-lock.json'));
  const lockfile = JSON.parse(lockfileBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (![2, 3].includes(lockfile.lockfileVersion) || !lockfile.packages || typeof lockfile.packages !== 'object' || Array.isArray(lockfile.packages) || !lockfile.packages['']) {
    throw new Error('A package-lock v2/v3 packages inventory with root metadata is required.');
  }
  const lockedRoot = lockfile.packages[''];
  if (lockedRoot.name !== packageJson.name || lockedRoot.version !== packageJson.version || lockfile.name !== packageJson.name || lockfile.version !== packageJson.version) {
    throw new Error('package.json and package-lock.json identify different root packages.');
  }
  for (const section of directSections) {
    if (JSON.stringify(orderedDeclarations(packageJson[section])) !== JSON.stringify(orderedDeclarations(lockedRoot[section]))) {
      throw new Error(`package.json and package-lock.json disagree on ${section}.`);
    }
  }
  const directNames = [...new Set(directSections.flatMap((section) => Object.keys(packageJson[section] ?? {})))].sort(compare);
  const directPaths = new Set(directNames.map((name) => `node_modules/${name}`));
  const npmResolved = Object.entries(lockfile.packages)
    .filter(([lockPath]) => lockPath !== '')
    .sort(([left], [right]) => compare(left, right))
    .map(([lockPath, metadata]) => {
      if (!lockPathPattern.test(lockPath) || lockPath.split('/').some((segment) => segment === '.' || segment === '..')) {
        throw new Error(`Unsupported or unsafe lockfile package path: ${lockPath}`);
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.link) {
        throw new Error(`Unsupported linked or invalid lockfile entry: ${lockPath}`);
      }
      const name = metadata.name ?? lockPath.split('node_modules/').at(-1);
      const version = metadata.version;
      if (typeof name !== 'string' || !new RegExp(`^${packageNamePattern}$`, 'i').test(name) || typeof version !== 'string' || !version.trim()) {
        throw new Error(`Missing or invalid package name/version: ${lockPath}`);
      }
      const license = requireLicense(metadata.license, lockPath);
      const optional = metadata.optional === true;
      let installed = true;
      let installedMetadata;
      try {
        installedMetadata = readJson(path.join(repositoryRoot, ...lockPath.split('/'), 'package.json'));
      } catch (error) {
        if (error.code !== 'ENOENT' || !optional) throw error;
        installed = false;
      }
      if (installed) {
        if (installedMetadata.name !== name || installedMetadata.version !== version) {
          throw new Error(`Installed package name/version conflicts with the lockfile: ${lockPath}`);
        }
        if (requireLicense(installedMetadata.license, `${lockPath}/package.json`) !== license) {
          throw new Error(`Installed package license conflicts with the lockfile: ${lockPath}`);
        }
      }
      const platform = Object.fromEntries(['os', 'cpu', 'libc'].map((field) => {
        const values = metadata[field] ?? [];
        if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
          throw new Error(`Invalid ${field} platform constraints: ${lockPath}`);
        }
        return [field, [...values].sort(compare)];
      }));
      return {
        name, version, license, lockPath,
        direct: directPaths.has(lockPath),
        development: metadata.dev === true,
        developmentOptional: metadata.devOptional === true,
        optional,
        installed,
        platform,
        licenseSource: 'package-lock.json',
      };
    });
  const resolvedByPath = new Map(npmResolved.map((item) => [item.lockPath, item]));
  const npmDirect = directNames.map((name) => {
    const item = resolvedByPath.get(`node_modules/${name}`);
    if (!item) throw new Error(`Direct dependency is absent from the lockfile inventory: ${name}`);
    return {
      name: item.name,
      version: item.version,
      license: item.license,
      development: Object.hasOwn(packageJson.devDependencies ?? {}, name),
      declaredName: name,
      lockPath: item.lockPath,
      declarations: directSections.filter((section) => Object.hasOwn(packageJson[section] ?? {}, name)),
    };
  });
  return {
    npmScope: {
      inventory: 'all-package-lock-resolved-locations',
      includes: ['direct', 'transitive', 'production', 'development', 'optional', 'all-locked-platforms'],
      excludes: ['root-project', 'unlocked-packages', 'final-binary-contents-analysis'],
      duplicatePolicy: 'preserve-each-lockfile-location-and-version',
      installedMetadataPolicy: 'validate-name-version-license; absent-optional-packages-use-lockfile',
      developmentFlags: 'development=lockfile.dev; developmentOptional=lockfile.devOptional',
      licensePolicy: 'nonempty-lockfile-license-required; installed-license-must-match',
    },
    npmLockfile: { path: 'package-lock.json', lockfileVersion: lockfile.lockfileVersion, sha256: createHash('sha256').update(lockfileBytes).digest('hex') },
    npmDirect,
    npmResolved,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.length !== 2 || argumentsList[0] !== '--root') throw new Error('Usage: node scripts/dependency-licenses.mjs --root <repository>');
    process.stdout.write(`${JSON.stringify(generateNpmLicenseReport({ root: argumentsList[1] }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Dependency license inventory failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
