module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "react", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "prettier"
  ],
  settings: {
    react: {
      version: "detect"
    },
    "import/resolver": {
      node: {
        extensions: [".js", ".jsx", ".ts", ".tsx"],
      },
    },
  },
  env: {
    browser: true,
    es2022: true,
    node: true,
    jest: true,
  },
  rules: {
    "no-console": "warn",
    "import/order": [
      "error",
      {
        "alphabetize": { order: "asc", caseInsensitive: true },
        "newlines-between": "always",
        "ignoreCase": true,
        "paths": [
          { "path": "./components", "import/barrel": true },
          { "path": "./lib", "import/barrel": true },
          { "path": "./utils", "import/barrel": true },
          { "path": "./packages/agent-trinity/skillmarkdown-architect", "import/barrel": true },
          { "path": "./packages/agent-trinity/vscode-agent-generator", "import/barrel": true },
          { "path": "./packages/agent-trinity/integration-explainer", "import/barrel": true }
        ]
      }
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "react/react-in-jsx-scope": "off"
  }
};
