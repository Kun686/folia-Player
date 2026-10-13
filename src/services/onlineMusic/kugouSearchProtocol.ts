import md5 from 'blueimp-md5';

// kugouSearchProtocol.ts — existing anonymous signature and account-cookie assembly, without transport.
export const kugouSessionCookie = (session: Record<string, string | undefined>): string => {
    const values = new Map<string, string>();
    const storedCookie = session.cookie;
    storedCookie?.split(';').forEach(entry => {
        const separator = entry.indexOf('=');
        if (separator <= 0) return;
        values.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
    });

    const token = session.token;
    const userId = session.userid;
    const dfid = session.dfid;
    if (dfid) values.set('dfid', dfid);
    if (token) values.set('token', token);
    if (userId) values.set('userid', userId);
    return Array.from(values, ([key, value]) => `${key}=${value}`).join(';');
};

export function kugouAnonymousSearchRequest(keyword: string, page: number, pagesize: number) {
    const clientTimeMs = Date.now();
    const clientTimeSec = Math.floor(clientTimeMs / 1000);
    const mid = md5(String(clientTimeMs));
    const params: Record<string, string | number> = {
        sorttype: '0',
        keyword,
        pagesize,
        page,
        userid: '0',
        appid: '3116',
        token: '',
        clienttime: clientTimeSec,
        iscorrection: '1',
        uuid: '-',
        mid,
        dfid: '-',
        clientver: '11070',
        platform: 'AndroidFilter',
    };
    const signatureSource = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('');
    params.signature = md5(
        `LnT6xpN3khm36zse0QzvmgTZ3waWdRSA${signatureSource}LnT6xpN3khm36zse0QzvmgTZ3waWdRSA`,
    );

    return { params, headers: {
            'User-Agent': 'Android14-1070-11070-201-0-SearchSong-wifi',
            'KG-Rec': '1',
            'KG-RC': '1',
            'KG-CLIENTTIMEMS': String(clientTimeMs),
            mid,
            'x-router': 'complexsearch.kugou.com',
        } };
}
