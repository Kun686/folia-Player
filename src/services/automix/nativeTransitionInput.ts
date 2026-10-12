// nativeTransitionInput.ts — bounded JSON validation shared by native transition adapters.
export const protocolVersion = 1;
export const fail = (): never => { throw new Error('invalid-transition-input'); };
export const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
export const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const optionalNumber = (value: unknown): boolean => value === null || numeric(value);
export const numbers = (value: unknown, length?: number): value is number[] =>
    Array.isArray(value) && (length === undefined || value.length === length) && value.every(numeric);

export function read(text: string): Record<string, unknown> {
    if (typeof text !== 'string' || text.length > 262144) fail();
    const value: unknown = JSON.parse(text);
    // Bound work before invoking the planner; non-finite JSON exponents are also rejected.
    let nodes = 0;
    function visit(item: unknown, depth: number): void {
        if (++nodes > 20000 || depth > 12) fail();
        if (typeof item === 'number' && !Number.isFinite(item)) fail();
        if (typeof item === 'string' && item.length > 4096) fail();
        if (item && typeof item === 'object') Object.values(item).forEach(child => visit(child, depth + 1));
    }
    visit(value, 0);
    const request = object(value);
    if (request.version !== protocolVersion) fail();
    return request;
}
