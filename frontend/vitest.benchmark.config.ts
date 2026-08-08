import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['benchmarks/**/*.benchmark.ts'],
    fileParallelism: false,
    pool: 'forks',
    execArgv: ['--expose-gc'],
  },
});
