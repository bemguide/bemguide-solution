// Root ESLint config — minimal. Each workspace package owns its own rules.
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/*.tsbuildinfo",
    "**/next-env.d.ts",
    "supabase/functions/**",
  ]),
]);
