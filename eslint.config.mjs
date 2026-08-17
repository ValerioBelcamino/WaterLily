import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // The strict preset rejects non-null assertions. The stylistic preset's
      // competing preference for `value!` would make explicit internal casts
      // impossible without contradictory lint errors.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['apps/desktop/scripts/*.mjs', 'e2e/*.mjs'],
  },
  {
    ...reactHooks.configs.flat['recommended-latest'],
    files: ['apps/web/src/**/*.{ts,tsx}'],
  },
  {
    ...reactRefresh.configs.vite,
    files: ['apps/web/src/**/*.{ts,tsx}'],
  },
);
