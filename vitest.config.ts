import { defineConfig } from 'vitest/config'

// 只收集 tests/ 下的测试，避免 vitest 误收集 vendor/gaussdb-src 内上游仓库自带测试。
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
  },
})
