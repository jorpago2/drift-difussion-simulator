import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  timeout: 45_000,
  expect: { timeout: 20_000 },
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:4184/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-light", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
    { name: "mobile-dark", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, colorScheme: "dark" } },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4184",
    url: "http://127.0.0.1:4184/index.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
