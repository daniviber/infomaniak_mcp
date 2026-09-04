import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'build/**'] },
  {
    files: [
      'src/domain/**/*.ts',
      'src/application/**/*.ts',
      'src/adapters/**/*.ts',
      'src/config/**/*.ts',
      'src/main/**/*.ts',
      'src/features/**/*.ts',
      'test/**/*.ts',
      'vitest.config.ts',
    ],
    extends: [...tseslint.configs.recommended],
  },
);
