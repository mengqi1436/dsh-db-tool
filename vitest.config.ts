import { defineConfig } from 'vitest/config'

// 只收集 tests/ 下的测试（GaussDB 驱动已 npm 化，vendor 仅余 mongodb-driver.cjs 单文件 bundle）。
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
  },
})
