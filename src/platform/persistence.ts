import type { AppState } from "../domain/types";
import { createDefaultState, migrateToV5, STORAGE_KEY_V1, STORAGE_KEY_V2, STORAGE_KEY_V3, STORAGE_KEY_V4 } from "../app/state";
import { createRuntimeMessage, messageFromUnknown, runtimeError } from "../domain/runtimeMessage";

interface PersistedEnvelope {
  current?: unknown;
  lastKnownGood?: unknown;
}

export interface PersistenceAdapter {
  load(): Promise<PersistedEnvelope | null>;
  save(envelope: PersistedEnvelope): Promise<void>;
}

export function isTauriRuntime(): boolean {
  return Boolean(globalThis.window?.__TAURI_INTERNALS__);
}

class TauriStoreAdapter implements PersistenceAdapter {
  constructor(private readonly fileName: string) {}
  private storePromise?: Promise<import("@tauri-apps/plugin-store").Store>;

  private async store() {
    if (!this.storePromise) {
      this.storePromise = import("@tauri-apps/plugin-store").then(({ load }) => load(this.fileName, { autoSave: false, defaults: {} }));
    }
    return this.storePromise;
  }

  async load(): Promise<PersistedEnvelope | null> {
    const store = await this.store();
    return { current: await store.get("current"), lastKnownGood: await store.get("lastKnownGood") };
  }

  async save(envelope: PersistedEnvelope): Promise<void> {
    const store = await this.store();
    await store.set("current", envelope.current);
    await store.set("lastKnownGood", envelope.lastKnownGood);
    await store.save();
  }
}

class IndexedDbAdapter implements PersistenceAdapter {
  constructor(private readonly database: string) {}
  private readonly storeName = "state";

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.database, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? runtimeError("errors.indexedDbOpen"));
    });
  }

  async load(): Promise<PersistedEnvelope | null> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readonly");
      const request = transaction.objectStore(this.storeName).get("envelope");
      request.onsuccess = () => resolve((request.result as PersistedEnvelope | undefined) ?? null);
      request.onerror = () => reject(request.error ?? runtimeError("errors.indexedDbRead"));
      transaction.oncomplete = () => database.close();
    });
  }

  async save(envelope: PersistedEnvelope): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readwrite");
      transaction.objectStore(this.storeName).put(envelope, "envelope");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? runtimeError("errors.indexedDbSave"));
      };
    });
  }
}

export function createPersistenceAdapter(): PersistenceAdapter {
  return isTauriRuntime() ? new TauriStoreAdapter("state-v5.json") : new IndexedDbAdapter("zhishutai-v5");
}

function createLegacyV4Adapter(): PersistenceAdapter {
  return isTauriRuntime() ? new TauriStoreAdapter("state-v4.json") : new IndexedDbAdapter("zhishutai-v4");
}

function createLegacyV3Adapter(): PersistenceAdapter {
  return isTauriRuntime() ? new TauriStoreAdapter("state-v3.json") : new IndexedDbAdapter("zhishutai-v3");
}

function legacyState(): { value: unknown; label: string } | null {
  try {
    const v4 = localStorage.getItem(STORAGE_KEY_V4);
    if (v4) return { value: JSON.parse(v4), label: "localStorage v4" };
    const v3 = localStorage.getItem(STORAGE_KEY_V3);
    if (v3) return { value: JSON.parse(v3), label: "localStorage v3" };
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2) return { value: JSON.parse(v2), label: "localStorage v2" };
    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) return { value: JSON.parse(v1), label: "localStorage v1" };
  } catch {
    /* Local storage can be unavailable in hardened WebViews. */
  }
  return null;
}

function isIncompleteSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const source = value as { version?: number; settings?: unknown; pools?: unknown };
  return [3, 4, 5].includes(Number(source.version)) && (!source.settings || !source.pools);
}

function readEnvelope(envelope: PersistedEnvelope | null, source: string, warnings: string[]): { state: AppState; source: string } | null {
  if (!envelope) return null;
  if (envelope.current) {
    try {
      if (isIncompleteSnapshot(envelope.current)) throw runtimeError("errors.currentDataCorrupt");
      return { state: migrateToV5(envelope.current, source), source: `${source}-current` };
    } catch (error) {
      warnings.push(createRuntimeMessage("errors.currentDataWarning", { message: messageFromUnknown(error) }));
    }
  }
  if (envelope.lastKnownGood) {
    try {
      if (isIncompleteSnapshot(envelope.lastKnownGood)) throw runtimeError("errors.recoveryCopyUnavailable");
      return { state: migrateToV5(envelope.lastKnownGood, source), source: `${source}-last-known-good` };
    } catch (error) {
      warnings.push(createRuntimeMessage("errors.recoveryCopyWarning", { message: messageFromUnknown(error) }));
    }
  }
  return null;
}

export async function loadPersistedState(adapter = createPersistenceAdapter()): Promise<{ state: AppState; warnings: string[]; source: string }> {
  const warnings: string[] = [];
  try {
    const loaded = readEnvelope(await adapter.load(), "v5", warnings);
    if (loaded) return { state: loaded.state, warnings, source: loaded.source };
  } catch (error) {
    warnings.push(createRuntimeMessage("errors.persistenceUnavailable", { message: messageFromUnknown(error) }));
  }
  try {
    const legacyV4 = readEnvelope(await createLegacyV4Adapter().load(), "v4", warnings);
    if (legacyV4) {
      warnings.push(createRuntimeMessage("settings.migration.storageUpgrade", { version: 4 }));
      return { state: legacyV4.state, warnings, source: legacyV4.source };
    }
  } catch (error) {
    warnings.push(createRuntimeMessage("errors.storageReadFailed", { version: 4, message: messageFromUnknown(error) }));
  }
  try {
    const legacyV3 = readEnvelope(await createLegacyV3Adapter().load(), "v3", warnings);
    if (legacyV3) {
      warnings.push(createRuntimeMessage("settings.migration.storageUpgrade", { version: 3 }));
      return { state: legacyV3.state, warnings, source: legacyV3.source };
    }
  } catch (error) {
    warnings.push(createRuntimeMessage("errors.storageReadFailed", { version: 3, message: messageFromUnknown(error) }));
  }
  const legacy = legacyState();
  if (legacy) {
    try {
      return { state: migrateToV5(legacy.value, legacy.label), warnings, source: legacy.label };
    } catch (error) {
      warnings.push(createRuntimeMessage("errors.legacyMigrationFailed", { message: messageFromUnknown(error) }));
    }
  }
  return { state: createDefaultState(), warnings, source: "defaults" };
}

export async function savePersistedState(state: AppState, adapter = createPersistenceAdapter()): Promise<void> {
  const valid = migrateToV5(structuredClone(state), "保存");
  let previous: AppState = valid;
  try {
    const envelope = await adapter.load();
    if (envelope?.current && !isIncompleteSnapshot(envelope.current)) {
      previous = migrateToV5(envelope.current, "上次当前");
    } else if (envelope?.lastKnownGood && !isIncompleteSnapshot(envelope.lastKnownGood)) {
      previous = migrateToV5(envelope.lastKnownGood, "上次有效");
    }
  } catch {
    /* The new valid snapshot becomes its own recovery point. */
  }
  await adapter.save({ current: valid, lastKnownGood: previous });
}
