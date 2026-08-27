import { mkdirSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  statErrors: new Map<string, NodeJS.ErrnoException>(),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    stat: async (p: any, ...rest: any[]) => {
      const path = typeof p === "string" ? p : (p as { path?: string } | undefined)?.path;
      if (typeof path === "string") {
        const err = state.statErrors.get(path);
        if (err) throw err;
      }
      return actual.stat(p as never, ...(rest as []));
    },
  };
});

let tmpHome: string;

beforeAll(async () => {
  mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
  tmpHome = await mkdtemp(join(process.cwd(), ".tmp", "hash-store-prune-strict-"));
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("XDG_CONFIG_HOME", "");
  const { initHasher } = await import("../../src/hashline/hasher");
  await initHasher();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(tmpHome, { recursive: true, force: true });
});

function eacces(message = "permission denied"): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code: "EACCES" }) as NodeJS.ErrnoException;
}

describe("hash-store - pruneMissing stat() error handling", () => {
  it("keeps snapshots and served records when stat() fails with EACCES", async () => {
    const filePath = join(tmpHome, "perm.ts");
    await writeFile(filePath, "keep\n", "utf-8");

    const { loadHashStore, pruneMissing, getSnapshot, shutdownHashStore } =
      await import("../../src/hash-store");
    const { recordServed, getServed } = await import("../../src/served");
    const { contentChecksum } = await import("../../src/hashline/hasher");
    const { splitLines } = await import("../../src/utils");

    shutdownHashStore();
    const store = await loadHashStore();
    const checksum = contentChecksum("keep\n");
    await store.stmts.upsert(filePath, checksum, splitLines("keep\n").length, JSON.stringify(["KEP"]), Date.now());
    recordServed(store, filePath, ["KEP"]);

    state.statErrors.set(filePath, eacces());

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await pruneMissing(store);
    } finally {
      errSpy.mockRestore();
      state.statErrors.clear();
    }

    expect(await getSnapshot(store, filePath, "keep\n")).toEqual(["KEP"]);
    expect(await getServed(store, filePath)).toEqual(new Set(["KEP"]));
  });

  it("keeps snapshots and served records when stat() fails with EPERM", async () => {
    const filePath = join(tmpHome, "eperm.ts");
    await writeFile(filePath, "keep\n", "utf-8");

    const { loadHashStore, pruneMissing, getSnapshot, shutdownHashStore } =
      await import("../../src/hash-store");
    const { recordServed, getServed } = await import("../../src/served");
    const { contentChecksum } = await import("../../src/hashline/hasher");
    const { splitLines } = await import("../../src/utils");

    shutdownHashStore();
    const store = await loadHashStore();
    const checksum = contentChecksum("keep\n");
    await store.stmts.upsert(filePath, checksum, splitLines("keep\n").length, JSON.stringify(["KEP"]), Date.now());
    recordServed(store, filePath, ["KEP"]);

    state.statErrors.set(
      filePath,
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }) as NodeJS.ErrnoException,
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await pruneMissing(store);
    } finally {
      errSpy.mockRestore();
      state.statErrors.clear();
    }

    expect(await getSnapshot(store, filePath, "keep\n")).toEqual(["KEP"]);
    expect(await getServed(store, filePath)).toEqual(new Set(["KEP"]));
  });

  it("still prunes when stat() returns ENOENT (existing behavior)", async () => {
    const { loadHashStore, pruneMissing, getSnapshot, shutdownHashStore } =
      await import("../../src/hash-store");
    const { recordServed, getServed } = await import("../../src/served");

    shutdownHashStore();
    const store = await loadHashStore();
    await store.stmts.upsert("/definitely-gone.ts", "checksum", 1, JSON.stringify(["GON"]), Date.now());
    recordServed(store, "/definitely-gone.ts", ["GON"]);

    await pruneMissing(store);

    expect(await getSnapshot(store, "/definitely-gone.ts", "x")).toBeUndefined();
    expect(await getServed(store, "/definitely-gone.ts")).toBeUndefined();
  });

  it("does not delete the SQLite snapshot row on non-ENOENT stat failure", async () => {
    const filePath = join(tmpHome, "row-keep.ts");
    await writeFile(filePath, "keep\n", "utf-8");

    const { loadHashStore, pruneMissing, shutdownHashStore, getSnapshot } =
      await import("../../src/hash-store");
    const { contentChecksum } = await import("../../src/hashline/hasher");
    const { splitLines } = await import("../../src/utils");

    shutdownHashStore();
    const store = await loadHashStore();
    const checksum = contentChecksum("keep\n");
    await store.stmts.upsert(filePath, checksum, splitLines("keep\n").length, JSON.stringify(["ROW"]), Date.now());

    state.statErrors.set(filePath, eacces());
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await pruneMissing(store);
    } finally {
      errSpy.mockRestore();
      state.statErrors.clear();
    }

    expect(await getSnapshot(store, filePath, "keep\n")).toEqual(["ROW"]);
  });
});
