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

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  // 1) Ignore these files/globs entirely
  { ignores: ["**/node_modules/**", "build/**", "dist/**"] },

  // 2) Bring in all of ESLint’s, TypeScript-ESLint’s, and Prettier’s recommended rules
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ),

  // 3) Then your overrides
  {
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser, // Use globals for browser environments
        ...globals.node, // Use globals for node environments
      },
    },

    plugins: {
      "@typescript-eslint": typescriptEslint,
      prettier,
    },

    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs"],
        },
      },
    },

    rules: {
      // No unused vars
      "@typescript-eslint/no-unused-vars": "error",

      // Enforce Prettier formatting
      "prettier/prettier": [
        "error",
        {
          endOfLine: "crlf",
        },
      ],

      // Windows-style line endings
      "linebreak-style": ["error", "windows"],

      // Prefer type-alias over interface or vice-versa
      "@typescript-eslint/consistent-type-definitions": "error",
    },
  },
];
