import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";

const browserGlobals = {
  chrome: "readonly",
  console: "readonly",
  document: "readonly",
  Event: "readonly",
  HTMLTextAreaElement: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  URL: "readonly",
  fetch: "readonly",
  window: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
};

const nodeGlobals = {
  Buffer: "readonly",
  console: "readonly",
  process: "readonly",
  setTimeout: "readonly",
  URL: "readonly",
  fetch: "readonly",
};

export default [
  js.configs.recommended,
  {
    ignores: ["coverage/**", "node_modules/**"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-control-regex": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["background.js", "lib.js", "popup.js", "sheets-instruction.js"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: ["local-server/**/*.js", "test/**/*.js"],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
  prettierConfig,
];
