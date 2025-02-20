// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            "no-prototype-builtins": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-namespace": "off",
            '@typescript-eslint/no-require-imports': 'off',
            'no-undef': 'off',
            "@typescript-eslint/no-unused-vars": ["error", { "varsIgnorePattern": "^_" }],
        },
    }
);
