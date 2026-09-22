// eslint.config.mjs
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import jsdoc from "eslint-plugin-jsdoc";
import prettierPlugin from "eslint-plugin-prettier/recommended";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // ESLint + TypeScript-ESLint recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware TS rules for app code
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ["src/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The no-unsafe-* family fires on any-typed values flowing out of external
      // SDKs and JSON parsing. Off until those boundaries get typed; the
      // async-correctness rules (no-floating-promises etc.) stay on.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      // Async callbacks passed to client.on() and setTimeout() are the bot's
      // event model; each one catches its own errors, and the process-level
      // unhandledRejection handler logs anything that slips through. Keep the
      // other misused-promise checks (conditionals, spreads) on.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },

  // JSDoc baseline (flat config variant, tuned for TS)
  jsdoc.configs["flat/recommended-typescript-error"],

  // Project-specific TS + JSDoc rules (Node bot - no browser globals)
  {
    files: ["**/*.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      // Core hygiene: require === except the idiomatic `!= null` check
      eqeqeq: ["error", "smart"],

      // TS hygiene
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/consistent-type-definitions": "error",
      "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],

      // JSDoc enforcement - named declarations/methods only; inline callbacks
      // (collector filters, .map/.catch handlers) stay undocumented.
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            FunctionExpression: false,
            ArrowFunctionExpression: false,
            MethodDefinition: true,
          },
        },
      ],
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/require-throws-type": "off",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-description": "error",
    },
  },

  // Turn off stylistic rules that clash with Prettier
  prettier,

  // Re-enable prettier/prettier rule so ESLint reports formatting violations
  prettierPlugin,

  // Ignores
  globalIgnores([
    "build/**",
    "node_modules/**",
    "dist/**",
    "coverage/**",
    ".eslintcache",
    "prettier.config.ts",
    "eslint.config.mjs",
  ]),
]);
