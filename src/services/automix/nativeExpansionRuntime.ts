import { planExpansion, renderExpansion, type ExpansionPlan } from './expansionGesture';
import { fail, numeric, object, read } from './nativeTransitionInput';

// nativeExpansionRuntime.ts — original performance gesture; PCM travels via owned typed arrays, never JSON.
export function nativeExpansion(request: Record<string, unknown>, swap: number, seconds: number): ExpansionPlan | null {
    const intensity = request.expansion;
    if (intensity === undefined || intensity === null) return null;
    const bar = request.outgoingBarSec, beats = request.outgoingBeatsPerBar ?? 4;
    if (!numeric(intensity) || intensity < 0.25 || intensity > 1
        || (bar !== null && (!numeric(bar) || bar <= 0 || bar > 30))
        || !numeric(beats) || beats < 1 || beats > 32) fail();
    return planExpansion(intensity as number, swap, bar as number | null, seconds, beats as number);
}

export function renderExpansionPCM(source: Float32Array, text: string): Float32Array {
    const request = read(text), plan = object(request.plan);
    const finite = (key: string, min: number, max: number) => numeric(plan[key]) && (plan[key] as number) >= min && (plan[key] as number) <= max;
    if (!finite('windowSec', 0.8, 30) || !finite('from', 0, 30) || !finite('to', 0, plan.windowSec as number)
        || (plan.to as number) - (plan.from as number) < 0.35 - 1e-8 || !finite('spinbackSec', 0, 10)
        || (plan.spinbackSec as number) > ((plan.to as number) - (plan.from as number)) / 3 + 1e-9
        || !Array.isArray(plan.repeats) || plan.repeats.length < 1 || plan.repeats.length > 256
        || !(source instanceof Float32Array) || source.length < 1 || source.length > 1_323_000
        || !source.every(value => Number.isFinite(value))) fail();
    const span = (plan.to as number) - (plan.from as number);
    for (const raw of plan.repeats as unknown[]) {
        const repeat = object(raw);
        for (const key of ['at', 'length', 'sourceAt', 'sourceLength', 'rate']) {
            if (!numeric(repeat[key]) || (repeat[key] as number) < 0) fail();
        }
        if ((repeat.length as number) <= 0 || (repeat.sourceLength as number) <= 0
            || (repeat.at as number) + (repeat.length as number) > span + 1e-8
            || (repeat.sourceAt as number) + (repeat.sourceLength as number) > (plan.windowSec as number) + 1e-8
            || (repeat.rate as number) < 1 || (repeat.rate as number) > 1.2) fail();
    }
    return renderExpansion([source], plan as unknown as ExpansionPlan, 44100)[0];
}
