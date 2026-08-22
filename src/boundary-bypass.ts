const boundaryBypassTracker = new Map<string, string>();

export function noopPayloadKey(
  absolutePath: string,
  removeFrom: string,
  removeTo: string,
  replacementLines: string[],
): string {
  return JSON.stringify([absolutePath, removeFrom, removeTo, replacementLines]);
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
