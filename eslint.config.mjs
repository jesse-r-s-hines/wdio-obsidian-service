// @ts-check
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores(["**/node_modules", "**/dist", "**/tsup.config.ts"]),
    {
        files: ["packages/**/*.ts"],
        extends: [
            eslint.configs.recommended,
            tseslint.configs.recommendedTypeChecked,
            {
                languageOptions: {
                    parserOptions: {
                        projectService: true,
                        tsconfigRootDir: import.meta.dirname,
                    },
                },
            },
            {
                rules: {
                    "no-prototype-builtins": "off",
                    'no-undef': 'off',
                    "prefer-const": ["error", {
                        "destructuring": "all",
                    }],
                    "@typescript-eslint/no-explicit-any": "off",
                    "@typescript-eslint/no-unsafe-argument": "off",
                    "@typescript-eslint/no-unsafe-assignment": "off",
                    "@typescript-eslint/no-unsafe-member-access": "off",
                    "@typescript-eslint/no-unsafe-return": "off",
                    "@typescript-eslint/no-unsafe-call": "off",
                    "@typescript-eslint/no-namespace": "off",
                    '@typescript-eslint/no-require-imports': 'off',
                    "@typescript-eslint/restrict-plus-operands": "off",
                    "@typescript-eslint/require-await": "off",
                    "@typescript-eslint/no-empty-object-type": "off",
                    "@typescript-eslint/restrict-template-expressions": "off",
                    "@typescript-eslint/no-misused-promises": ["error", {
                        checksVoidReturn: false,
                    }],
                    "@typescript-eslint/no-unused-vars": ["error", {
                        varsIgnorePattern: "^_",
                        destructuredArrayIgnorePattern: ".*",
                        ignoreRestSiblings: true,
                    }],
                },
            }
        ],
    },
]);
