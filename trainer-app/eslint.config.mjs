import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-ui-audit/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "storybook-static/**",
    ".claude/**",
    "artifacts/**",
    ".tmp/**",
    ".vercel/**",
    "output/**",
    "playwright-report/**",
    "test-results/**",
    ".eslintcache",
  ]),
]);

export default eslintConfig;
