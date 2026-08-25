import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { constants } from "fs";
import { execPipeline, type ReqParams } from "./replace";
import { commitEdit } from "./commit";
import { readNormFile } from "./file-reader";
import { resolveTarget } from "./fs-write";
import { MAX_HASH_LINES, parseHashRef, resolveAnchorLine } from "./hashline";
import { stripAnchorRow } from "./hashline/resolve";
import { toCwd } from "./paths";
import { loadP, loadGuide } from "./prompts";
import { normReq } from "./replace-normalize";
import { abortIf, isRec, makePrepareArguments, rejectUnknownFields, splitLines } from "./utils";
import { clearBoundaryBypass } from "./boundary-bypass";

const INSERT_KS = new Set(["path", "anchor", "direction", "lines"]);

export interface InsertReq {
  path: string;
  anchor: string;
  direction: "before" | "after";
  lines: string[];
}

export function assertInsertReq(request: unknown): asserts request is InsertReq {
  if (!isRec(request)) {
    throw new Error("[E_BAD_SHAPE] Insert request must be an object.");
  }
  rejectUnknownFields(request, INSERT_KS, "Insert request");
  if (typeof request.path !== "string" || request.path.length === 0) {
    throw new Error('[E_BAD_SHAPE] Insert request requires a non-empty "path" string.');
  }
  if (typeof request.anchor !== "string" || request.anchor.length === 0) {
    throw new Error('[E_BAD_SHAPE] Insert request requires an "anchor" string (3-char hash from read output).');
  }
  if (request.direction !== "before" && request.direction !== "after") {
    throw new Error('[E_BAD_SHAPE] Insert request "direction" must be "before" or "after".');
  }
  if (!Array.isArray(request.lines) || request.lines.some((line) => typeof line !== "string")) {
    throw new Error('[E_BAD_SHAPE] Insert request requires "lines" as an array of strings, one element per line.');
  }
}

const insertToolSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to the file to edit",
    }),
    anchor: Type.String({
      description:
        'Bare 3-char HASH only (e.g. "aB3"): copy just the hash from the leftmost column of a read row like `aB3│content`; never the line content. A pasted diff row like `+aB3│x` or a `HASH│` prefix is stripped automatically with a warning. The anchored line is preserved; the new lines go after or before it.',
    }),
    direction: Type.Union(
      [
        Type.Literal("after", { description: "Insert the lines after the anchor line" }),
        Type.Literal("before", { description: "Insert the lines before the anchor line" }),
      ],
      { description: '"after" or "before"' },
    ),
    lines: Type.Array(
      Type.String({
        description:
          "One line to insert. Each element is exactly one line; do not embed \\n inside an element: use separate elements.",
      }),
      {
        description:
          'Lines to insert as an array of strings, one element per line. Use [""] for a blank line. The anchor line is preserved; never include it in lines.',
      }
    ),
  },
  { additionalProperties: false },
);

export function regInsert(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "insert",
    label: "Insert",
    description: loadP("../prompts/insert.md"),
    promptSnippet: loadP("../prompts/insert-snippet.md"),
    promptGuidelines: loadGuide("../prompts/insert-guidelines.md"),
    prepareArguments: makePrepareArguments(),
    parameters: insertToolSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const canonical = normReq(params);
      assertInsertReq(canonical);
      const req = canonical;
      const path = req.path;
      const trimmedAnchor = req.anchor.trim();
      const anchorWarnings: string[] = [];
      const anchorText = stripAnchorRow(trimmedAnchor, "anchor entry", anchorWarnings);
      const ref = parseHashRef(anchorText);
      const absolutePath = toCwd(path, ctx.cwd);
      const mutationTargetPath = await resolveTarget(absolutePath);
      return withFileMutationQueue(mutationTargetPath, async () => {
        abortIf(signal);
        const preload = await readNormFile(path, ctx.cwd, {
          signal,
          accessMode: constants.R_OK | constants.W_OK,
          maxLines: MAX_HASH_LINES,
        });
        const fileLines = splitLines(preload.normalized);
        const line = resolveAnchorLine(ref, fileLines, preload.fileHashes, path);
        const anchorLine = preload.normalized.length === 0 ? undefined : fileLines[line - 1];
        const editParams: ReqParams = {
          path,
          remove_from: ref.hash,
          remove_to: ref.hash,
          replacement_lines:
            anchorLine === undefined
              ? [...req.lines]
              : req.direction === "after"
                ? [anchorLine, ...req.lines]
                : [...req.lines, anchorLine],
        };
        const pipe = await execPipeline(editParams, ctx.cwd, {
          accessMode: constants.R_OK | constants.W_OK,
          signal,
          preloadedNorm: preload,
          skipBoundaryDedup: true,
        });
        return commitEdit(pipe, {
          path,
          absolutePath,
          mutationTargetPath,
          signal,
          verb: "inserted",
          noopNoun: "Insertion",
          foldedAnchorLines: anchorLine === undefined ? 0 : 1,
          prefixWarnings: anchorWarnings,
          onApplied: () => clearBoundaryBypass(mutationTargetPath),
        });
      });
    },
  });
}
