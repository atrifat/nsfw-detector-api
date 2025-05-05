import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.node } },
  {
    files: ["__tests__/**/*.mjs"], // Apply this configuration only to test files
    languageOptions: {
      globals: {
        ...globals.jest, // Add Jest globals
        ...globals.node // Keep Node.js globals as tests might use them
      }
    }
  }
]);