// eslint.config.js
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compat wrapper to merge ESLint’s recommended configs
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  // 1) Files/globs to ignore entirely
  { ignores: ["**/node_modules/**", "build/**", "dist/**"] },

  // 2) Bring in ESLint, TypeScript‑ESLint and Prettier recommended rules
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ),

  // 3) Our project‑specific overrides
  {
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser, // browser global vars (window, etc.)
        ...globals.node, // Node.js global vars (process, Buffer, etc.)
      },
    },

    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
    },

    settings: {
      // Resolve imports for these extensions
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"],
        },
      },
    },

    rules: {
      // Treat any unused variable as an error
      "@typescript-eslint/no-unused-vars": "error",

      // Enforce Prettier formatting as ESLint errors
      "prettier/prettier": [
        "error",
        {
          endOfLine: "crlf",
        },
      ],

      // Ensure Windows‑style line endings
      "linebreak-style": ["error", "windows"],

      // Consistent choice between `type` vs `interface`
      "@typescript-eslint/consistent-type-definitions": "error",
    },
  },
];
