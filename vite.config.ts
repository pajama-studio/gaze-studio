import { defineConfig } from "vite";
export default defineConfig({
  css: { postcss: { plugins: [] } },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8798",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            if (incoming.headers.origin === "http://127.0.0.1:5198")
              request.setHeader("Origin", "http://127.0.0.1:8798");
          });
        },
      },
    },
  },
  build: { target: "es2022" },
});
