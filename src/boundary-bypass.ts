import { parseText } from "./hashline/parse";
import { ANCHOR_ROW_RE } from "./hashline/resolve";
import { HL_BARE_PREFIX_RE, HL_PREFIX_PLUS_RE, HL_PREFIX_MINUS_RE } from "./hashline/hash";

function canonRef(ref: string): string {
  const trimmed = ref.trim();
  const match = trimmed.match(ANCHOR_ROW_RE);
  return match ? match[2]! : trimmed;
}

function canonLines(lines: string[]): string[] {
  return parseText(lines).map((line) => {
    const bare = line.match(HL_BARE_PREFIX_RE);
    if (bare) return line.slice(bare[0].length);
    const plus = line.match(HL_PREFIX_PLUS_RE);
    if (plus) return line.slice(plus[0].length);
    const minus = line.match(HL_PREFIX_MINUS_RE);
    if (minus) return line.slice(minus[0].length);
    return line;
  });
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

export function clearBoundaryBypass(absolutePath: string): void {
  boundaryBypassTracker.delete(absolutePath);
}
