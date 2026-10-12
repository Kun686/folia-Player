// stemWindow.ts — original session's media coverage and late-wiring arithmetic, shared with native planning.
export function stemWindowCoverage(outAt: number, outFrom: number, outFrames: number,
    inAt: number, inFrom: number, inFrames: number, seconds: number, rate: number) {
    const offset = Math.round((outAt - outFrom) * rate), inOffset = Math.round((inAt - inFrom) * rate);
    const length = Math.round(seconds * rate);
    return { offset, inOffset, length,
        covered: offset >= 0 && inOffset >= 0 && offset + length <= outFrames && inOffset + length <= inFrames };
}

export function stemWindowLate(at: number, plannedAt: number, outFrames: number, inFrames: number,
    offset: number, inOffset: number, length: number, rate: number): number {
    return Math.min(at - plannedAt, (outFrames - (offset + length)) / rate, (inFrames - (inOffset + length)) / rate);
}
