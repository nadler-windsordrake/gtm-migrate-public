import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "vite.config.ts"],
    languageOptions: {
      globals: {
        Blob: "readonly",
        URL: "readonly",
        chrome: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        fetch: "readonly",
        HTMLElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLSelectElement: "readonly",
        MouseEvent: "readonly",
        setTimeout: "readonly",
        console: "readonly",
      },
    },
  },
);
