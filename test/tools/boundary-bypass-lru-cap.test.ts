import { describe, expect, it } from "vitest";
import {
  BOUNDARY_BYPASS_LIMIT,
  boundaryBypassTrackerSize,
  clearBoundaryBypass,
  consumeBoundaryBypass,
  markBoundaryNoop,
  noopPayloadKey,
} from "../../src/boundary-bypass";

describe("boundaryBypassTracker LRU cap", () => {
  it("exports a positive BOUNDARY_BYPASS_LIMIT", () => {
    expect(BOUNDARY_BYPASS_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(BOUNDARY_BYPASS_LIMIT)).toBe(true);
  });

  it("evicts the oldest entry once the cap is reached", () => {
    const limit = BOUNDARY_BYPASS_LIMIT;
    expect(boundaryBypassTrackerSize()).toBeLessThanOrEqual(limit);

    for (let i = 0; i < limit + 5; i++) {
      const path = `/lru-test/file-${i}.ts`;
      const payload = noopPayloadKey(path, "aaa", "aaa", ["x"]);
      markBoundaryNoop(path, payload);
    }
    expect(boundaryBypassTrackerSize()).toBe(limit);
  });

  it("updating an existing entry does not count as a new insert", () => {
    const path = "/lru-test/existing.ts";
    const oldPayload = noopPayloadKey(path, "aaa", "aaa", ["x"]);
    const newPayload = noopPayloadKey(path, "bbb", "bbb", ["y"]);
    markBoundaryNoop(path, oldPayload);
    const sizeAfterFirst = boundaryBypassTrackerSize();
    markBoundaryNoop(path, newPayload);
    expect(boundaryBypassTrackerSize()).toBe(sizeAfterFirst);
    expect(consumeBoundaryBypass(path, oldPayload)).toBe(false);
    expect(consumeBoundaryBypass(path, newPayload)).toBe(true);
    clearBoundaryBypass(path);
  });
});
