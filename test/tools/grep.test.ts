import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { loadHashStore, getSnapshot } from "../../src/hash-store";
import { getServed } from "../../src/served";
import { resolveTarget } from "../../src/fs-write";
import { toCwd } from "../../src/paths";
import { withTempFile, withTempDir, makeFakePiRegistry, setupIntegrationTest, getText, extractHash } from "../support/fixtures";
import register from "../../index";

describe("grep tool", () => {
  it("registers a tool named grep", () => {
    const { pi, getTool } = makeFakePiRegistry();
    register(pi);
    const tool = getTool("grep");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("grep");
  });

  it("returns matching lines with the same anchors as read", async () => {
    await withTempFile("sample.ts", "alpha\nbeta\ngamma\n", async ({ cwd }) => {
      const { ctx, readTool, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const readResult = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const readHash = extractHash(getText(readResult).split("\n").find((l) => l.includes("│beta"))!);

      const result = await grepTool.execute(
        "g1",
        { pattern: "beta", path: "sample.ts" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("=== sample.ts ===");
      expect(text).toContain("│beta");
      const grepHash = extractHash(text.split("\n").find((l) => l.includes("│beta"))!);
      expect(grepHash).toBe(readHash);
    });
  });

  it("serves grep anchors so a replace edits immediately", async () => {
    await withTempFile("sample.ts", "alpha\nbeta\ngamma\n", async ({ cwd, path }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const editTool = getTool("replace");

      const result = await grepTool.execute(
        "g1",
        { pattern: "beta", path: "sample.ts" },
        undefined, undefined, ctx,
      );
      const betaHash = extractHash(getText(result).split("\n").find((l) => l.includes("│beta"))!);

      const edit = await editTool.execute(
        "e1",
        { path: "sample.ts", remove_from: betaHash, remove_to: betaHash, replacement_lines: ["BETA"] },
        undefined, undefined, ctx,
      );
      expect(edit.content[0].text).toContain("Successfully replaced");
      expect(await import("fs/promises").then((m) => m.readFile(path, "utf-8"))).toBe("alpha\nBETA\ngamma\n");
    });
  });

  it("does not persist hash snapshots while searching", async () => {
    await withTempFile("sample.ts", "alpha\nbeta\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");

      await grepTool.execute(
        "g1",
        { pattern: "beta", path: "sample.ts" },
        undefined, undefined, ctx,
      );

      const store = await loadHashStore();
      const resolved = await resolveTarget(toCwd("sample.ts", cwd));
      expect(await getSnapshot(store, resolved, "alpha\nbeta\n")).toBeUndefined();
      const servedSet = await getServed(store, resolved);
      expect(servedSet?.size).toBeGreaterThan(0);
    });
  });

  it("includes context lines with anchors", async () => {
    await withTempFile("sample.ts", "alpha\nbeta\ngamma\ndelta\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");

      const result = await grepTool.execute(
        "g1",
        { pattern: "beta", path: "sample.ts", context: 1 },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("│alpha");
      expect(text).toContain("│beta");
      expect(text).toContain("│gamma");
      expect(text).not.toContain("│delta");
    });
  });

  it("matches literal text by default and regex only with regex: true", async () => {
    await withTempFile("sample.ts", "axb\na.b\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const literalResult = await grepTool.execute(
        "g1",
        { pattern: "a.b", path: "sample.ts" },
        undefined, undefined, ctx,
      );
      const literalText = getText(literalResult);
      expect(literalText).toContain("│a.b");
      expect(literalText).not.toContain("│axb");
      const regexResult = await grepTool.execute(
        "g2",
        { pattern: "a.b", path: "sample.ts", regex: true },
        undefined, undefined, ctx,
      );
      const regexText = getText(regexResult);
      expect(regexText).toContain("│axb");
      expect(regexText).toContain("│a.b");
    });
  });
  it("rejects regex: true combined with literal: true", async () => {
    await withTempFile("sample.ts", "alpha\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      await expect(
        grepTool.execute(
          "g1",
          { pattern: "alpha", path: "sample.ts", regex: true, literal: true },
          undefined, undefined, ctx,
        ),
      ).rejects.toThrow(/E_BAD_SHAPE/);
    });
  });
  it("warns [W_LITERAL_LIKELY] when a regex-with-metachar pattern matches nothing", async () => {
    await withTempFile("sample.ts", "alpha\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "v1.0", path: "sample.ts", regex: true },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("No matches found.");
      expect(text).toContain("[W_LITERAL_LIKELY]");
      expect(text).toContain("regex metacharacters");
    });
  });
  it("does not warn [W_LITERAL_LIKELY] when a regex pattern does match", async () => {
    await withTempFile("sample.ts", "v1.0\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "v1.0", path: "sample.ts", regex: true },
        undefined, undefined, ctx,
      );
      expect(getText(result)).not.toContain("[W_LITERAL_LIKELY]");
    });
  });

  it("supports case-insensitive search", async () => {
    await withTempFile("sample.ts", "ALPHA\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");

      const result = await grepTool.execute(
        "g1",
        { pattern: "alpha", path: "sample.ts", ignoreCase: true },
        undefined, undefined, ctx,
      );
      expect(getText(result)).toContain("│ALPHA");
    });
  });

  it("searches a directory recursively and skips node_modules", async () => {
    await withTempDir("grep-dir-", async (dir) => {
      await mkdir(join(dir, "src"), { recursive: true });
      await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(dir, "src", "a.ts"), "needle in src\n", "utf-8");
      await writeFile(join(dir, "node_modules", "pkg", "b.ts"), "needle in node_modules\n", "utf-8");

      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "needle" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("=== src/a.ts ===");
      expect(text).toContain("│needle in src");
      expect(text).not.toContain("node_modules");
    });
  });

  it("skips binary files silently", async () => {
    await withTempDir("grep-bin-", async (dir) => {
      await writeFile(join(dir, "a.txt"), "needle here\n", "utf-8");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      await writeFile(join(dir, "img.png"), png);

      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "needle" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("│needle here");
      expect(text).not.toContain("img.png");
    });
  });

  it("caps matches at the limit with a hint", async () => {
    await withTempFile("sample.ts", Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");

      const result = await grepTool.execute(
        "g1",
        { pattern: "^line", path: "sample.ts", limit: 5, regex: true },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("showing first 5 matches");
      const rows = text.split("\n").filter((l) => /^[A-Za-z0-9]{3}│/.test(l));
      expect(rows).toHaveLength(5);
    });
  });

  it("filters by glob", async () => {
    await withTempDir("grep-glob-", async (dir) => {
      await writeFile(join(dir, "a.ts"), "needle\n", "utf-8");
      await writeFile(join(dir, "b.txt"), "needle\n", "utf-8");

      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "needle", glob: "*.ts" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("a.ts");
      expect(text).not.toContain("b.txt");
    });
  });

  it("glob * matches files in subdirectories", async () => {
    await withTempDir("grep-glob-deep-", async (dir) => {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "a.ts"), "needle\n", "utf-8");
      await writeFile(join(dir, "top.spec.ts"), "needle\n", "utf-8");

      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "needle", glob: "*.ts" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("src/a.ts");
      expect(text).toContain("top.spec.ts");
    });
  });

  it("matches glob against the search root when path is a subdirectory", async () => {
    await withTempDir("grep-glob-root-", async (dir) => {
      await mkdir(join(dir, "lib", "deep"), { recursive: true });
      await writeFile(join(dir, "lib", "a.ts"), "needle\n", "utf-8");
      await writeFile(join(dir, "lib", "deep", "b.ts"), "needle\n", "utf-8");
      await writeFile(join(dir, "c.ts"), "needle\n", "utf-8");

      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "needle", path: "lib", glob: "*.ts" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("lib/a.ts");
      expect(text).toContain("lib/deep/b.ts");
      expect(text).not.toContain("c.ts");
    });
  });

  it("skips a line-oversized file in a directory scan", async () => {
    await withTempDir("grep-big-", async (dir) => {
      await writeFile(join(dir, "small.ts"), "needle\n", "utf-8");
      await writeFile(join(dir, "huge.ts"), Array.from({ length: 240000 }, (_, i) => `line ${i}`).join("\n"), "utf-8");

      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "needle" },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("small.ts");
      expect(text).toContain("│needle");
      expect(text).not.toContain("huge.ts");
      expect(text).not.toContain("E_FILE_TOO_LARGE");
    });
  });

  it("labels a 2000-row output as a row cut, not as a match-limit cut", async () => {
    await withTempDir("grep-rows-", async (dir) => {
      const lines = Array.from({ length: 2500 }, (_, i) => (i % 3 === 0 ? "m" : "s"));
      await writeFile(join(dir, "many.txt"), lines.join("\n") + "\n", "utf-8");
      const { ctx, getTool } = setupIntegrationTest(dir);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "m", path: "many.txt", context: 2, limit: 1000 },
        undefined, undefined, ctx,
      );
      const text = getText(result);
      expect(text).toContain("output truncated at 2000 rows");
      expect(text).not.toContain("showing first");
    });
  });

  it("reports no matches", async () => {
    await withTempFile("sample.ts", "alpha\nbeta\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { pattern: "zzz", path: "sample.ts" },
        undefined, undefined, ctx,
      );
      expect(getText(result)).toBe("No matches found.");
      expect((result.details as { metrics: { matches: number } }).metrics.matches).toBe(0);
    });
  });

  it("rejects an invalid pattern", async () => {
    await withTempFile("sample.ts", "alpha\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      await expect(
        grepTool.execute(
          "g1",
          { pattern: "(", path: "sample.ts", regex: true },
        ),
      ).rejects.toThrow(/E_BAD_SHAPE/);
    });
  });

  it("rejects a missing path", async () => {
    await withTempFile("sample.ts", "alpha\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      await expect(
        grepTool.execute(
          "g1",
          { pattern: "alpha", path: "missing.ts" },
          undefined, undefined, ctx,
        ),
      ).rejects.toThrow(/E_NOT_FOUND/);
    });
  });

  it("supports the file_path alias", async () => {
    await withTempFile("sample.ts", "alpha\n", async ({ cwd }) => {
      const { ctx, getTool } = setupIntegrationTest(cwd);
      const grepTool = getTool("grep");
      const result = await grepTool.execute(
        "g1",
        { file_path: "sample.ts", pattern: "alpha" },
        undefined, undefined, ctx,
      );
      expect(getText(result)).toContain("│alpha");
    });
  });
});
