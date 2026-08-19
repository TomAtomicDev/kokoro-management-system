import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const SERVICE_WORKER_BUILD_TOKEN = "__KOKORO_BUILD_ID__";
const PWA_TEMPLATE_TOKENS = {
  name: "__KOKORO_PWA_NAME__",
  shortName: "__KOKORO_PWA_SHORT_NAME__",
  themeColor: "__KOKORO_PWA_THEME_COLOR__",
  title: "__KOKORO_PWA_TITLE__",
} as const;

const PWA_IDENTITIES = {
  production: {
    name: "Kokoro Management",
    shortName: "Kokoro",
    themeColor: "#0f766e",
    title: "Kokoro",
  },
  staging: {
    name: "QA-Kokoro",
    shortName: "QA-Kokoro",
    themeColor: "#b45309",
    title: "QA-Kokoro",
  },
} as const;

type PwaIdentity = (typeof PWA_IDENTITIES)[keyof typeof PWA_IDENTITIES];

function resolvePwaIdentity(environment: string | undefined): PwaIdentity {
  const normalizedEnvironment = environment?.trim().toLowerCase() || "production";

  if (normalizedEnvironment === "staging") return PWA_IDENTITIES.staging;
  if (normalizedEnvironment === "production") return PWA_IDENTITIES.production;

  throw new Error(
    `VITE_APP_ENV must be either "staging" or "production", received "${environment}"`,
  );
}

function applyPwaIdentity(template: string, identity: PwaIdentity): string {
  return template
    .replaceAll(PWA_TEMPLATE_TOKENS.name, identity.name)
    .replaceAll(PWA_TEMPLATE_TOKENS.shortName, identity.shortName)
    .replaceAll(PWA_TEMPLATE_TOKENS.themeColor, identity.themeColor)
    .replaceAll(PWA_TEMPLATE_TOKENS.title, identity.title);
}

function templatePwaIdentity(): Plugin {
  let identity = PWA_IDENTITIES.production;

  return {
    name: "kokoro-template-pwa-identity",
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), "");
      const appEnvironment = env.VITE_APP_ENV ?? (mode === "staging" ? "staging" : "production");
      identity = resolvePwaIdentity(appEnvironment);
    },
    transformIndexHtml(html) {
      return applyPwaIdentity(html, identity);
    },
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", async (_request, response) => {
        const manifestPath = fileURLToPath(
          new URL("./public/manifest.webmanifest", import.meta.url),
        );
        const template = await readFile(manifestPath, "utf8");
        response.setHeader("Content-Type", "application/manifest+json");
        response.end(applyPwaIdentity(template, identity));
      });
    },
    async closeBundle() {
      const distDirectory = fileURLToPath(new URL("./dist", import.meta.url));
      const manifestPath = join(distDirectory, "manifest.webmanifest");
      const template = await readFile(manifestPath, "utf8");
      await writeFile(manifestPath, applyPwaIdentity(template, identity), "utf8");
    },
  };
}

function stampServiceWorker(): Plugin {
  return {
    name: "kokoro-stamp-service-worker",
    apply: "build",
    async closeBundle() {
      const distDirectory = fileURLToPath(new URL("./dist", import.meta.url));
      const indexHtml = await readFile(join(distDirectory, "index.html"), "utf8");
      const buildId = createHash("sha256").update(indexHtml).digest("hex").slice(0, 12);
      const serviceWorkerPath = join(distDirectory, "sw.js");
      const serviceWorker = await readFile(serviceWorkerPath, "utf8");

      if (!serviceWorker.includes(SERVICE_WORKER_BUILD_TOKEN)) {
        throw new Error(`Expected ${SERVICE_WORKER_BUILD_TOKEN} in ${serviceWorkerPath}`);
      }

      await writeFile(
        serviceWorkerPath,
        serviceWorker.replaceAll(SERVICE_WORKER_BUILD_TOKEN, buildId),
        "utf8",
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), templatePwaIdentity(), stampServiceWorker()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
