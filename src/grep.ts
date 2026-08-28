import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdir, stat } from "fs/promises";
import { dirname, join, relative } from "path";
import { loadFileKindAndText } from "./file-kind";
import { readNormFile } from "./file-reader";
import { MAX_HASH_LINES, fmtRow } from "./hashline";
import { toCwd } from "./paths";
import { loadP, loadGuide } from "./prompts";
import { normReq } from "./replace-normalize";
import { recordServedSafe } from "./served";
import { abortIf, errCode, isRec, makePrepareArguments, rejectUnknownFields, visLines } from "./utils";

const GREP_KS = new Set(["pattern", "path", "glob", "context", "ignoreCase", "literal", "limit", "skip", "no_skip"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".tmp", "coverage"]);
const MAX_SCAN_FILES = 4000;
const MAX_SHOWN_ROWS = 2000;

export interface GrepReq {
  pattern: string;
  path?: string;
  glob?: string;
  context?: number;
  ignoreCase?: boolean;
  literal?: boolean;
  limit?: number;
  skip?: string[];
  no_skip?: boolean;
}

export function assertGrepReq(request: unknown): asserts request is GrepReq {
  if (!isRec(request)) {
    throw new Error("[E_BAD_SHAPE] Grep request must be an object.");
  }
  rejectUnknownFields(request, GREP_KS, "Grep request");
  if (typeof request.pattern !== "string" || request.pattern.length === 0) {
    throw new Error('[E_BAD_SHAPE] Grep request requires a non-empty "pattern" string.');
  }
  if (request.context !== undefined && (typeof request.context !== "number" || !Number.isInteger(request.context) || request.context < 0)) {
    throw new Error('[E_BAD_SHAPE] Grep request field "context" must be a non-negative integer.');
  }
  if (request.no_skip !== undefined && typeof request.no_skip !== "boolean") {
    throw new Error('[E_BAD_SHAPE] Grep request field "no_skip" must be a boolean.');
  }
  if (request.skip !== undefined && (!Array.isArray(request.skip) || request.skip.some((s) => typeof s !== "string"))) {
    throw new Error('[E_BAD_SHAPE] Grep request field "skip" must be a string[].');
  }
  if (request.limit !== undefined && (typeof request.limit !== "number" || !Number.isInteger(request.limit) || request.limit < 1)) {
    throw new Error('[E_BAD_SHAPE] Grep request field "limit" must be a positive integer.');
  }
}

function buildRegex(pattern: string, literal: boolean, ignoreCase: boolean): RegExp {
  const source = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  try {
    return new RegExp(source, ignoreCase ? "ui" : "u");
  } catch {
    throw new Error(`[E_BAD_SHAPE] Invalid pattern: ${pattern}`);
  }
}

function globToRegex(glob: string): RegExp {
  let normalized = glob;
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  let source = "";
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i]!;
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        i += 2;
        if (normalized[i] === "/") {
          i += 1;
          source += "(?:.*\\/)?";
        } else {
          source += ".*";
        }
        continue;
      }
      source += ".*";
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    i += 1;
  }
  return new RegExp(`^${source}$`);
}

function classifyLoadError(error: unknown): "tooLarge" | "permission" | "other" {
  if (error instanceof Error && error.message.startsWith("[E_FILE_TOO_LARGE]")) return "tooLarge";
  const code = errCode(error);
  if (code === "EACCES" || code === "EPERM" || code === "ELOOP") return "permission";
  return "other";
}

function isSkipableLoadError(error: unknown): boolean {
  const code = errCode(error);
  if (code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "ELOOP") return true;
  return error instanceof Error && error.message.startsWith("[E_FILE_TOO_LARGE]");
}
interface FileHit {
  path: string;
  displayPath: string;
  fileHashes: string[];
  rows: string[];
  hashes: string[];
  matchCount: number;
  totalMatchCount: number;
}

interface SkipStats {
  tooLarge: number;
  permission: number;
  unreadableDir: number;
}

interface ScanState {
  scanned: number;
  stopped: boolean;
  skipped: SkipStats;
}

async function walkFiles(
  root: string,
  state: ScanState,
  skipDirs: Set<string>,
  onFile: (absPath: string) => Promise<void>,
): Promise<void> {
  const queue: string[] = [root];
  while (queue.length > 0 && !state.stopped) {
    const dir = queue.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errCode(error) !== "ENOENT") state.skipped.unreadableDir += 1;
      continue;
    }
    for (const entry of entries) {
      if (state.stopped) break;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        queue.push(full);
      } else if (entry.isFile()) {
        state.scanned += 1;
        if (state.scanned > MAX_SCAN_FILES) {
          state.stopped = true;
          break;
        }
        await onFile(full);
      }
    }
  }
}

async function searchFile(
  absPath: string,
  globRoot: string,
  cwd: string,
  regex: RegExp,
  globRegex: RegExp | undefined,
  context: number,
  maxMatches: number,
  skip: SkipStats,
): Promise<FileHit | undefined> {
  const displayPath = relative(cwd, absPath).replace(/\\/g, "/");
  if (globRegex) {
    const candidates = [relative(globRoot, absPath), relative(cwd, absPath)].map((p) =>
      p.replace(/\\/g, "/"),
    );
    if (!candidates.some((p) => globRegex.test(p))) return undefined;
  }
  let file;
  try {
    file = await loadFileKindAndText(absPath, { maxLines: MAX_HASH_LINES, displayPath });
  } catch (error) {
    if (isSkipableLoadError(error)) {
      const kind = classifyLoadError(error);
      if (kind === "tooLarge") skip.tooLarge += 1;
      else if (kind === "permission") skip.permission += 1;
      return undefined;
    }
    throw error;
  }
  if (file.kind !== "text") return undefined;
  let norm;
  try {
    norm = await readNormFile(absPath, cwd, { maxLines: MAX_HASH_LINES, preloadedFile: file, noPersist: true });
  } catch (error) {
    if (isSkipableLoadError(error)) {
      const kind = classifyLoadError(error);
      if (kind === "tooLarge") skip.tooLarge += 1;
      else if (kind === "permission") skip.permission += 1;
      return undefined;
    }
    throw error;
  }
  const lines = visLines(norm.normalized);
  const matchLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]!)) matchLines.push(i);
  }
  if (matchLines.length === 0) return undefined;
  const keptMatches = matchLines.length > maxMatches ? matchLines.slice(0, maxMatches) : matchLines;
  const shown = new Set<number>();
  for (const i of keptMatches) {
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) shown.add(j);
  }
  const sorted = [...shown].sort((a, b) => a - b);
  const rows: string[] = [];
  const hashes: string[] = [];
  for (const idx of sorted) {
    rows.push(fmtRow(norm.fileHashes[idx]!, lines[idx]!));
    hashes.push(norm.fileHashes[idx]!);
  }
  return {
    path: norm.absolutePath,
    displayPath,
    fileHashes: norm.fileHashes,
    rows,
    hashes,
    matchCount: keptMatches.length,
    totalMatchCount: matchLines.length,
  };
}

const grepToolSchema = Type.Object(
  {
    pattern: Type.String({
      description: "Search pattern (regex or literal string)",
    }),
    path: Type.Optional(
      Type.String({
        description: "Directory or file to search (default: current directory)",
      }),
    ),
    glob: Type.Optional(
      Type.String({
        description: "Filter files by glob pattern; * matches across directories, e.g. '*.ts' or '**/*.spec.ts'",
      }),
    ),
    ignoreCase: Type.Optional(
      Type.Boolean({
        description: "Case-insensitive search (default: false)",
      }),
    ),
    literal: Type.Optional(
      Type.Boolean({
        description: "Treat pattern as literal string instead of regex (default: false)",
      }),
    ),
    context: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Number of lines to show before and after each match (default: 0)",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum number of matches to return (default: 100)",
      }),
    ),
    skip: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Directory names to skip during recursive scan (replaces the default node_modules/.git/.tmp/coverage list). E.g. ["node_modules", "dist"].',
      }),
    ),
    no_skip: Type.Optional(
      Type.Boolean({
        description: "If true, scan into every directory including node_modules, .git, etc. Slow and may time out.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function regGrep(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description: loadP("../prompts/grep.md"),
    promptSnippet: loadP("../prompts/grep-snippet.md"),
    promptGuidelines: loadGuide("../prompts/grep-guidelines.md"),
    prepareArguments: makePrepareArguments(),
    parameters: grepToolSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const canonical = normReq(params);
      assertGrepReq(canonical);
      const req = canonical;
      const regex = buildRegex(req.pattern, req.literal === true, req.ignoreCase === true);
      const context = req.context ?? 0;
      const limit = req.limit ?? 100;
      const globRegex = req.glob === undefined ? undefined : globToRegex(req.glob);
      const base = req.path ? toCwd(req.path, ctx.cwd) : ctx.cwd;
      abortIf(signal);
      let baseStat;
      try {
        baseStat = await stat(base);
      } catch (error) {
        if (errCode(error) === "ENOENT") {
          throw new Error(`[E_NOT_FOUND] File not found: ${req.path ?? ctx.cwd}`);
        }
        throw new Error(`[E_ACCESS] Cannot access path: ${req.path ?? ctx.cwd}`);
      }
      const globRoot = baseStat.isFile() ? dirname(base) : base;
      const state: ScanState = {
        scanned: 0,
        stopped: false,
        skipped: { tooLarge: 0, permission: 0, unreadableDir: 0 },
      };
      const files: string[] = [];
      if (baseStat.isFile()) {
        files.push(base);
      } else {
        const skipDirs = req.no_skip === true ? new Set<string>() : req.skip && req.skip.length > 0 ? new Set(req.skip) : SKIP_DIRS;
        await walkFiles(base, state, skipDirs, async (absPath) => {
          files.push(absPath);
        });
      }
      const hits: FileHit[] = [];
      let matches = 0;
      let limitTruncated = false;
      let rowTruncated = false;
      let rowCount = 0;
      for (const absPath of files) {
        abortIf(signal);
        const remaining = limit - matches;
        if (remaining <= 0) {
          limitTruncated = true;
          break;
        }
        const hit = await searchFile(absPath, globRoot, ctx.cwd, regex, globRegex, context, remaining, state.skipped);
        if (!hit) continue;
        const rowBudget = MAX_SHOWN_ROWS - rowCount;
        if (rowBudget <= 0) {
          rowTruncated = true;
          break;
        }
        const keptRows = hit.rows.slice(0, rowBudget);
        const keptHashes = hit.hashes.slice(0, rowBudget);
        rowCount += keptRows.length;
        if (hit.totalMatchCount > hit.matchCount) limitTruncated = true;
        if (keptRows.length < hit.rows.length) rowTruncated = true;
        matches += hit.matchCount;
        hits.push({ ...hit, rows: keptRows, hashes: keptHashes });
      }
      for (const hit of hits) {
        await recordServedSafe(hit.path, hit.hashes, "grep", new Set(hit.fileHashes));
      }
      const blocks = hits
        .map((hit) => `=== ${hit.displayPath} ===\n${hit.rows.join("\n")}`)
        .join("\n");
      const notes: string[] = [];
      if (rowTruncated) notes.push(`[grep: output truncated at ${MAX_SHOWN_ROWS} rows; refine the pattern to see more.]`);
      if (state.stopped) notes.push(`[grep: scan cap of ${MAX_SCAN_FILES} files reached; results may be incomplete.]`);
      if (state.skipped.tooLarge > 0) notes.push(`[grep: ${state.skipped.tooLarge} file(s) skipped (over the ${MAX_HASH_LINES}-line limit); refine path or raise limits.]`);
      if (state.skipped.permission > 0) notes.push(`[grep: ${state.skipped.permission} file(s) skipped (EACCES/EPERM); check permissions.]`);
      if (state.skipped.unreadableDir > 0) notes.push(`[grep: ${state.skipped.unreadableDir} directory(ies) unreadable.]`);
      if (limitTruncated) notes.push(`[grep: hit the ${limit}-match limit; rerun with limit=${limit * 5} to see the rest.]`);
      const truncated = limitTruncated || rowTruncated;
      const text = blocks.length > 0 ? `${blocks}${notes.length > 0 ? `\n${notes.join("\n")}` : ""}` : "No matches found.";
      return {
        content: [{ type: "text", text }],
        details: {
          metrics: {
            matches,
            files: hits.length,
            truncated: truncated || state.stopped,
            skipped: { ...state.skipped },
            limit: { requested: limit, returned: matches, hit: limitTruncated },
            rows: { cap: MAX_SHOWN_ROWS, returned: rowCount, hit: rowTruncated },
          },
        },
      };
    },
  });
}
