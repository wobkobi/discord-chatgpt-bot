import type { Config } from "prettier";

const config: Config = {
  plugins: ["prettier-plugin-organize-imports"],
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [{ files: ["*.json", "*.yml", "*.yaml"], options: { singleQuote: false } }],
};

export default config;
