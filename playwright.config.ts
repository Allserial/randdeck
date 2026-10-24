import { defineConfig } from "@playwright/test";

const localBypass = "127.0.0.1,localhost";
process.env.NO_PROXY = [process.env.NO_PROXY, localBypass].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./reports/playwright/results",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./reports/playwright/html", open: "never" }],
  ],
  use: {
    baseURL: origin,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1180, height: 820 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `npm run ${process.env.PLAYWRIGHT_PREVIEW ? "preview" : "dev"} -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    env: { ...process.env, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.NO_PROXY },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
