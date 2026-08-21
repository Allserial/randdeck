export type RuntimeMessageParams = Record<string, string | number | boolean>;

export interface RuntimeMessageDescriptor {
  key: string;
  params: RuntimeMessageParams;
}

const RUNTIME_MESSAGE_PREFIX = "randdeck-message:";

export function createRuntimeMessage(key: string, params: RuntimeMessageParams = {}): string {
  return `${RUNTIME_MESSAGE_PREFIX}${encodeURIComponent(JSON.stringify({ key, params }))}`;
}

export function parseRuntimeMessage(message: string): RuntimeMessageDescriptor | null {
  if (!message.startsWith(RUNTIME_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(message.slice(RUNTIME_MESSAGE_PREFIX.length))) as Partial<RuntimeMessageDescriptor>;
    if (!parsed || typeof parsed.key !== "string" || !parsed.key) return null;
    const params = parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params)
      ? parsed.params as RuntimeMessageParams
      : {};
    return { key: parsed.key, params };
  } catch {
    return null;
  }
}

export class RandDeckError extends Error {
  readonly code: string;
  readonly params: RuntimeMessageParams;

  constructor(code: string, params: RuntimeMessageParams = {}) {
    super(createRuntimeMessage(code, params));
    this.name = "RandDeckError";
    this.code = code;
    this.params = params;
  }
}

export function runtimeError(code: string, params: RuntimeMessageParams = {}): RandDeckError {
  return new RandDeckError(code, params);
}

export function messageFromUnknown(error: unknown, fallbackKey = "errors.unknown"): string {
  return error instanceof Error && error.message ? error.message : createRuntimeMessage(fallbackKey);
}
