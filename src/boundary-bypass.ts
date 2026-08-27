import { parseText } from "./hashline/parse";
import { ANCHOR_ROW_RE } from "./hashline/resolve";
import { stripRowPrefix } from "./hashline/hash";

function canonRef(ref: string): string {
  const trimmed = ref.trim();
  const match = trimmed.match(ANCHOR_ROW_RE);
  return match ? match[2]! : trimmed;
}

function canonLines(lines: string[]): string[] {
  return parseText(lines).map((line) => stripRowPrefix(line).text);
}

const boundaryBypassTracker = new Map<string, string>();

export function noopPayloadKey(
  absolutePath: string,
  removeFrom: string,
  removeTo: string,
  replacementLines: string[],
): string {
  return JSON.stringify([
    absolutePath,
    canonRef(removeFrom),
    canonRef(removeTo),
    canonLines(replacementLines),
  ]);
}

export function markBoundaryNoop(absolutePath: string, payload: string): void {
  boundaryBypassTracker.set(absolutePath, payload);
}

export function consumeBoundaryBypass(absolutePath: string, payload: string): boolean {
  if (boundaryBypassTracker.get(absolutePath) === payload) {
    boundaryBypassTracker.delete(absolutePath);
    return true;
  }
  return false;
}

export function peekBoundaryBypass(absolutePath: string, payload: string): boolean {
  return boundaryBypassTracker.get(absolutePath) === payload;
}

export function clearBoundaryBypass(absolutePath: string): void {
  boundaryBypassTracker.delete(absolutePath);
}
