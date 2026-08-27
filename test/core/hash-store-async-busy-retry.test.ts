import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { mkdirSync } from "node:fs";

const state = vi.hoisted(() => ({
  busyOnce: null as Error | null,
  persistentBusy: false,
  runCalls: 0,
}));

vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    get isOpen() {
      return true;
    }
    exec() {}
    prepare(sql: string) {
      if (sql.includes("PRAGMA quick_check")) {
        return { get: () => ({ quick_check: "ok" }) };
      }
      if (sql.includes("SELECT value FROM meta WHERE key = 'version'")) {
        return { get: () => ({ value: "5" }) };
      }
      return {
        get: () => undefined,
        all: () => [],
        run: () => {
          state.runCalls++;
          if (state.busyOnce) {
            const err = state.busyOnce;
            if (!state.persistentBusy) state.busyOnce = null;
            throw err;
          }
        },
      };
    }
    close() {}
  },
}));

function busyError(): Error {
  return Object.assign(new Error("database is locked"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5,
  }) as Error;
}

let tmpHome: string;

beforeAll(async () => {
  mkdirSync(join(process.cwd(), ".tmp"), { recursive: true });
  tmpHome = await mkdtemp(join(process.cwd(), ".tmp", "hash-store-async-busy-"));
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("XDG_CONFIG_HOME", "");
  const { initHasher } = await import("../../src/hashline/hasher");
  await initHasher();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(tmpHome, { recursive: true, force: true });
});

describe("hash store async busy retry", () => {
  it("upsertSnapshot retries on a busy error without blocking the event loop", async () => {
    state.busyOnce = busyError();
    state.persistentBusy = false;
    state.runCalls = 0;

    const { loadHashStore, upsertSnapshot, shutdownHashStore } =
      await import("../../src/hash-store");
    shutdownHashStore();
    const store = await loadHashStore();

    let observed = 0;
    const start = Date.now();
    const waitForTicks = new Promise<void>((resolve) => {
      const tick = () => {
        observed++;
        if (Date.now() - start < 200) setTimeout(tick, 10);
        else resolve();
      };
      setTimeout(tick, 10);
    });

    await upsertSnapshot(store, "/p.ts", "checksum", 1, ["AAA"]);
    await waitForTicks;

    expect(state.runCalls).toBeGreaterThan(1);
    expect(observed).toBeGreaterThan(0);
  });
});
