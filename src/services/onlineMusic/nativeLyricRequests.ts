import { Buffer } from 'buffer';

// nativeLyricRequests.ts — bounded Promise I/O for JavaScriptCore; every job owns its requests and timers.
export type LyricRequest = { provider: 'netease' | 'kugou' | 'qq' | 'lyrics' | 'amll'; path: string;
    query?: Record<string, string | number | boolean | undefined>; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string };
export type LyricReply = { status: number; body: string };
type Pending = { resolve: (value: LyricReply) => void; reject: (error: Error) => void };
export type LyricEvent = { id: number; kind: 'request'; request: LyricRequest }
    | { id: number; kind: 'timer'; milliseconds: number } | { id: number; kind: 'cancel' };
export type LyricIO = (request: LyricRequest) => Promise<LyricReply>;

export class NativeLyricRequests {
    private serial = 0;
    private stopped = false;
    private pending = new Map<number, Pending>();
    private events: LyricEvent[] = [];
    private register(event: Omit<Extract<LyricEvent, { kind: 'request' }>, 'id'> | Omit<Extract<LyricEvent, { kind: 'timer' }>, 'id'>) {
        if (this.stopped || this.serial >= 128 || this.pending.size >= 16) throw new Error('lyric-job-limit');
        const id = ++this.serial;
        const promise = new Promise<LyricReply>((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
        this.events.push({ ...event, id });
        return { id, promise };
    }
    drain(): LyricEvent[] { const events = this.events; this.events = []; return events; }
    reply(text: string): void {
        if (Buffer.byteLength(text, 'utf8') > 12_100_000) throw new Error('lyrics-too-large');
        const message = JSON.parse(text), pending = this.pending.get(message.id);
        // Late replies are intentionally harmless after timeout, cancellation or completion.
        if (!pending) return;
        this.pending.delete(message.id);
        const reply = message.reply as LyricReply;
        if (message.error || !reply || !Number.isInteger(reply.status) || reply.status < 100 || reply.status > 599
            || typeof reply.body !== 'string' || Buffer.byteLength(reply.body, 'utf8') > 2_000_000) {
            pending.reject(new Error('lyric-request-failed'));
        } else pending.resolve(reply);
    }
    private cancel(id: number) {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); this.events.push({ kind: 'cancel', id });
        pending.reject(new Error('lyric-request-cancelled'));
    }
    stop(): void {
        this.stopped = true;
        for (const id of this.pending.keys()) this.cancel(id);
    }
    // A port deadline covers its entire multi-request flow, including parse awaits and chorus lookup.
    async operation<T>(milliseconds: number, work: (request: LyricIO) => Promise<T>): Promise<T> {
        const ids = new Set<number>();
        let active = true;
        try {
            return await this.deadline(work(async request => {
                if (!active) throw new Error('lyric-request-cancelled');
                const item = this.register({ kind: 'request', request }); ids.add(item.id);
                try { return await item.promise; } finally { ids.delete(item.id); }
            }), milliseconds);
        } finally {
            active = false;
            for (const id of ids) this.cancel(id);
        }
    }
    async deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
        // A stopped/limited scheduler may refuse the timer after the caller already started its Promise.
        // Observe that Promise even then, so cancellation cannot leave an unhandled rejection behind.
        void promise.catch(() => undefined);
        if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 10000) throw new Error('invalid-lyric-deadline');
        const timer = this.register({ kind: 'timer', milliseconds });
        try { return await Promise.race([promise, timer.promise.then(() => { throw new Error('lyric-timeout'); })]); }
        finally { this.cancel(timer.id); }
    }
    async withTimeout<T>(promise: Promise<T>, milliseconds: number, _label: string, fallback: T): Promise<T> {
        try { return await this.deadline(promise, milliseconds); } catch { return fallback; }
    }
}

// URLSearchParams is unavailable in bare JavaScriptCore; this is its UTF-8 form-query encoding.
export function lyricQuery(query: Record<string, string | number | boolean>): string {
    const encode = (value: string) => encodeURIComponent(value).replace(/[!'()~]/g,
        character => '%' + character.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
    return Object.entries(query).map(([key, value]) => `${encode(key)}=${encode(String(value))}`).join('&');
}
export function lyricBody(reply: LyricReply): any {
    if (reply.status < 200 || reply.status >= 300) throw new Error('lyric-unavailable');
    const raw = JSON.parse(reply.body), value = raw?.body ?? raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-lyric-response');
    return value;
}
