import { defineConfig } from "vitest/config";

const mockIsolatedFiles = [
  "test/core/config-atomic.test.ts",
  "test/core/hash-store-open-errors.test.ts",
  "test/core/validation-access.test.ts",
  "test/tools/fs-write.cleanup.test.ts",
  "test/tools/fs-write-cleanup-on-error.test.ts",
  "test/tools/fs-write.permissions.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "mock-isolated",
          include: mockIsolatedFiles,
          isolate: true,
        },
      },
      {
        test: {
          name: "shared",
          include: ["test/**/*.test.ts"],
          exclude: mockIsolatedFiles,
          isolate: false,
        },
      },
    ],
  },
});
