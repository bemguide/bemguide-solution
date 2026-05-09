import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    rules: {
      // React 19 strict-purity rules over-fire on legitimate patterns:
      //   - server components legitimately read Date.now() once per request,
      //   - client components lazy-init useState from window.Telegram on mount.
      // Both are explicitly allowed by React's own docs. We re-enable case-by-case
      // if a real cascading-render bug shows up.
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      // Apostrophes in Ukrainian text (м'ясо, ім'я, etc.) trigger this rule.
      // We rely on Prettier to keep JSX safe; raw `'` inside a child string is fine.
      "react/no-unescaped-entities": "off",
    },
  },
]);
