import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: mode !== "production",
    rollupOptions: {
      input: {
        popup: "popup.html",
        review: "review.html",
      },
    },
  },
}));
