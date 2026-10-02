import tseslint from "typescript-eslint";

export default [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {},
  },
  {
    files: ["**/builtins/**/*.ts", "packages/server/src/extensions/builtins/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../*",
                "../**",
                "@rollforge/server",
                "@rollforge/server/**",
                "node:*",
                "fs",
                "path",
                "os",
                "crypto",
                "http",
                "events",
                "child_process",
                "stream",
              ],
              message:
                "Built-in extensions may only import from @rollforge/extension-api, @rollforge/protocol, or local (./) modules.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Dynamic import() is not allowed in built-in extensions.",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "require() is not allowed in built-in extensions.",
        },
      ],
    },
  },
];
