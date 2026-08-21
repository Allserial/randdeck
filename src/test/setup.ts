import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import { initializeI18n } from "../i18n";

beforeAll(async () => {
  await initializeI18n("zh-CN");
});

afterEach(() => cleanup());

Object.defineProperty(globalThis, "matchMedia", {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });
