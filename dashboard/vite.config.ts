import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const worker = "http://localhost:8787";

export default defineConfig({
  base: "/dashboard/",
  plugins: [react()],
  build: { outDir: "dist/dashboard", emptyOutDir: true },
  server: {
    proxy: {
      "/v1": {
        target: worker,
        changeOrigin: true,
        configure: (proxy) => proxy.on("proxyReq", (request) => request.setHeader("Origin", worker)),
      },
    },
  },
});
