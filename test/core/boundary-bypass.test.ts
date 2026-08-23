import { describe, expect, it, beforeEach } from "vitest";
import {
  noopPayloadKey,
  markBoundaryNoop,
  consumeBoundaryBypass,
  clearBoundaryBypass,
} from "../../src/boundary-bypass";

const P = "/tmp/boundary-bypass-test/a.ts";
const OTHER = "/tmp/boundary-bypass-test/b.ts";

describe("noopPayloadKey", () => {
  it("distinguishes paths, anchors, and replacement lines", () => {
    const base = { removeFrom: "BBB", removeTo: "BBB", replacementLines: ["b"] };
    expect(noopPayloadKey("/a.ts", "BBB", "BBB", ["b"])).toBe(
      JSON.stringify(["/a.ts", "BBB", "BBB", ["b"]]),
    );
    expect(noopPayloadKey("/b.ts", base.removeFrom, base.removeTo, base.replacementLines)).not.toBe(
      noopPayloadKey("/a.ts", base.removeFrom, base.removeTo, base.replacementLines),
    );
    expect(noopPayloadKey("/a.ts", "CCC", base.removeTo, base.replacementLines)).not.toBe(
      noopPayloadKey("/a.ts", base.removeFrom, base.removeTo, base.replacementLines),
    );
    expect(noopPayloadKey("/a.ts", base.removeFrom, base.removeTo, ["x"])).not.toBe(
      noopPayloadKey("/a.ts", base.removeFrom, base.removeTo, base.replacementLines),
    );
  });
});

describe("boundary noop bypass", () => {
  beforeEach(() => clearBoundaryBypass(P));

  it("consumes the bypass once for the matching payload", () => {
    const payload = noopPayloadKey(P, "BBB", "BBB", ["b"]);
    markBoundaryNoop(P, payload);
    expect(consumeBoundaryBypass(P, payload)).toBe(true);
    expect(consumeBoundaryBypass(P, payload)).toBe(false);
  });

  it("does not consume the bypass for another payload", () => {
    const payload = noopPayloadKey(P, "BBB", "BBB", ["b"]);
    const other = noopPayloadKey(P, "CCC", "CCC", ["c"]);
    markBoundaryNoop(P, payload);
    expect(consumeBoundaryBypass(P, other)).toBe(false);
    expect(consumeBoundaryBypass(P, payload)).toBe(true);
  });

  it("keeps the bypass per path", () => {
    const payload = noopPayloadKey(P, "BBB", "BBB", ["b"]);
    markBoundaryNoop(P, payload);
    expect(consumeBoundaryBypass(OTHER, payload)).toBe(false);
    expect(consumeBoundaryBypass(P, payload)).toBe(true);
  });

  it("overwrites a pending bypass when a newer boundary noop arms it", () => {
    const first = noopPayloadKey(P, "BBB", "BBB", ["b"]);
    const second = noopPayloadKey(P, "CCC", "CCC", ["c"]);
    markBoundaryNoop(P, first);
    markBoundaryNoop(P, second);
    expect(consumeBoundaryBypass(P, first)).toBe(false);
    expect(consumeBoundaryBypass(P, second)).toBe(true);
  });

  it("clears the bypass with clearBoundaryBypass", () => {
    const payload = noopPayloadKey(P, "BBB", "BBB", ["b"]);
    markBoundaryNoop(P, payload);
    clearBoundaryBypass(P);
    expect(consumeBoundaryBypass(P, payload)).toBe(false);
  });
});

describe("noopPayloadKey canonicalization", () => {
  it("normalizes anchor whitespace and copied prefixes", () => {
    const bare = noopPayloadKey(P, "aB3", "cD4", ["x"]);
    expect(noopPayloadKey(P, " aB3 ", "cD4", ["x"])).toBe(bare);
    expect(noopPayloadKey(P, "aB3│alpha", "cD4", ["x"])).toBe(bare);
    expect(noopPayloadKey(P, "+aB3│alpha", "cD4", ["x"])).toBe(bare);
    expect(noopPayloadKey(P, "-aB3│alpha", "cD4", ["x"])).toBe(bare);
  });

  it("normalizes replacement line boundaries and copied prefixes", () => {
    const base = noopPayloadKey(P, "aB3", "cD4", ["  x", "y"]);
    expect(noopPayloadKey(P, "aB3", "cD4", ["  x\ny"])).toBe(base);
    expect(noopPayloadKey(P, "aB3", "cD4", ["  x\r\ny"])).toBe(base);
    expect(noopPayloadKey(P, "aB3", "cD4", ["aB3│  x", "y"])).toBe(base);
    expect(noopPayloadKey(P, "aB3", "cD4", ["+aB3│  x", "y"])).toBe(base);
    expect(noopPayloadKey(P, "aB3", "cD4", ["-aB3│  x", "y"])).toBe(base);
    expect(noopPayloadKey(P, "aB3", "cD4", ["-   │  x", "y"])).toBe(base);
  });

  it("keeps meaningful blank lines distinct", () => {
    expect(noopPayloadKey(P, "aB3", "cD4", ["a", ""])).not.toBe(
      noopPayloadKey(P, "aB3", "cD4", ["a"]),
    );
  });

  it("keeps genuinely different edits distinct", () => {
    expect(noopPayloadKey(P, "aB3", "cD4", ["x"])).not.toBe(
      noopPayloadKey(P, "aB3", "cD4", ["y"]),
    );
    expect(noopPayloadKey(P, "aB3", "cD4", ["x"])).not.toBe(
      noopPayloadKey(P, "cC4", "cD4", ["x"]),
    );
  });
});
