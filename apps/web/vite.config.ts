import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const SERVICE_WORKER_BUILD_TOKEN = "__KOKORO_BUILD_ID__";

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
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
