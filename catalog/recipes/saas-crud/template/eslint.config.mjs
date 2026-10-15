import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Local service mocks for the E2E run (plain Node scripts).
    files: ["tests/e2e/mocks/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
  },
  {
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      // Security Pack: the shared rate limiter is async; without await its Promise is always truthy and never blocks.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='rateLimit']:not(AwaitExpression > CallExpression)",
          message:
            "Await the rate limiter: `if (!(await rateLimit(key))) …` (src/security/rate-limit.ts).",
        },
      ],
    },
  },
);
