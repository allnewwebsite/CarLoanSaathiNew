import js from "@eslint/js";

const browserGlobals = {
  atob: "readonly",
  Blob: "readonly",
  BroadcastChannel: "readonly",
  CustomEvent: "readonly",
  document: "readonly",
  crypto: "readonly",
  EventSource: "readonly",
  fetch: "readonly",
  File: "readonly",
  FormData: "readonly",
  globalThis: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  performance: "readonly",
  self: "readonly",
  sessionStorage: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  Buffer: "readonly",
  console: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "build/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    plugins: {
      "react-hooks": {
        rules: {
          "exhaustive-deps": {
            meta: { type: "suggestion" },
            create() {
              return {};
            },
          },
        },
      },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
        React: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-case-declarations": "off",
      "no-constant-binary-expression": "off",
      "no-prototype-builtins": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
