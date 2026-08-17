import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import { withTempFile, setupIntegrationTest, getText, extractHash } from "../support/fixtures";


describe("replace tool — first-line whitespace preservation", () => {
  it("preserves leading whitespace on the first line of the replacement (LF file)", async () => {
    await withTempFile("sample.ts", "aaa\nbbb\nccc\n", async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const readResult = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines = getText(readResult).split("\n");
      const bHash = extractHash(lines.find((l: string) => l.includes("│bbb"))!);
      const editResult = await editTool.execute(
        "e1",
        { path: "sample.ts", remove_from: bHash, remove_to: bHash, replacement_text: "  BBB" },
        undefined, undefined, ctx,
      );
      expect(editResult.content[0].text).toContain("Successfully replaced");
      expect(await readFile(path, "utf-8")).toBe("aaa\n  BBB\nccc\n");
    });
  });

  it("preserves leading whitespace on the first line of the replacement (CRLF file)", async () => {
    await withTempFile("sample.ts", "aaa\r\nbbb\r\nccc\r\n", async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const readResult = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines = getText(readResult).split("\n");
      const bHash = extractHash(lines.find((l: string) => l.includes("│bbb"))!);
      const editResult = await editTool.execute(
        "e1",
        { path: "sample.ts", remove_from: bHash, remove_to: bHash, replacement_text: "  BBB" },
        undefined, undefined, ctx,
      );
      expect(editResult.content[0].text).toContain("Successfully replaced");
      expect(await readFile(path, "utf-8")).toBe("aaa\r\n  BBB\r\nccc\r\n");
    });
  });

  it("normalizes CRLF separators inside replacement_text without losing first-line whitespace", async () => {
    await withTempFile("sample.ts", "aaa\r\nbbb\r\nccc\r\n", async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const readResult = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines = getText(readResult).split("\n");
      const bHash = extractHash(lines.find((l: string) => l.includes("│bbb"))!);
      const editResult = await editTool.execute(
        "e1",
        { path: "sample.ts", remove_from: bHash, remove_to: bHash, replacement_text: "  BBB\r\n  CCC" },
        undefined, undefined, ctx,
      );
      expect(editResult.content[0].text).toContain("Successfully replaced");
      expect(await readFile(path, "utf-8")).toBe("aaa\r\n  BBB\r\n  CCC\r\nccc\r\n");
    });
  });

  it("applies first-line re-indentation exactly when replacing a range", async () => {
    await withTempFile("sample.ts", "aaa\nbbb\nccc\nddd\n", async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const readResult = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines = getText(readResult).split("\n");
      const bHash = extractHash(lines.find((l: string) => l.includes("│bbb"))!);
      const cHash = extractHash(lines.find((l: string) => l.includes("│ccc"))!);
      const editResult = await editTool.execute(
        "e1",
        { path: "sample.ts", remove_from: bHash, remove_to: cHash, replacement_text: "    BBB\n  CCC" },
        undefined, undefined, ctx,
      );
      expect(editResult.content[0].text).toContain("Successfully replaced");
      expect(await readFile(path, "utf-8")).toBe("aaa\n    BBB\n  CCC\nddd\n");
    });
  });

  it("strips a pasted HASH│ prefix but keeps the content indentation after it", async () => {
    await withTempFile("sample.ts", "aaa\n  bbb\nccc\n", async ({ cwd, path }) => {
      const { ctx, readTool, editTool } = setupIntegrationTest(cwd);
      const readResult = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const lines = getText(readResult).split("\n");
      const bRow = lines.find((l: string) => l.includes("│  bbb"))!;
      const bHash = extractHash(bRow);
      const editResult = await editTool.execute(
        "e1",
        { path: "sample.ts", remove_from: bHash, remove_to: bHash, replacement_text: `${bHash}│  BBB` },
        undefined, undefined, ctx,
      );
      expect(editResult.content[0].text).toContain("Successfully replaced");
      expect(await readFile(path, "utf-8")).toBe("aaa\n  BBB\nccc\n");
    });
  });
});
