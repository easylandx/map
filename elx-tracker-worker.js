// EasyLandX link tracker — Cloudflare Worker (free plan is plenty)
//
// What it does
//   POST /l        (admin) store or update a preview payload under a short id
//   GET  /l/:id    (public) return the payload, so map.html#p=ID can open the preview
//   POST /o/:id    (public) count one open of that link (no IP, no cookies, no personal data stored)
//   GET  /s?ids=a,b (admin) open counts for your own links, polled by the map
//
// Setup (about 5 minutes)
//   1. Cloudflare dashboard > Workers & Pages > Create > Worker. Paste this file and deploy.
//   2. Storage & Databases > KV > Create a namespace (e.g. elx-links).
//   3. Worker > Settings > Bindings > Add > KV namespace. Variable name: LINKS. Pick the namespace.
//   4. Worker > Settings > Variables and Secrets > Add a Secret named ADMIN_KEY with a long random value.
//   5. Copy the worker URL (https://xxxx.workers.dev) into CONFIG.TRACK in map.html and upload map.html.
//   6. Open the map, press 🔔 in the Leads bar and paste the same ADMIN_KEY.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-admin-key',
  'access-control-max-age': '86400'
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
const ID = /^[A-Za-z0-9]{6,12}$/;
const YEAR = 60 * 60 * 24 * 365;
const BOT = /bot|crawl|spider|preview|headless|facebookexternalhit|whatsapp|telegram|slack|curl|python|wget/i;

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const u = new URL(req.url), p = u.pathname.split('/').filter(Boolean);
    const admin = () => !!env.ADMIN_KEY && same(req.headers.get('x-admin-key') || '', env.ADMIN_KEY);
    try {
      if (req.method === 'POST' && p[0] === 'l' && p.length === 1) {
        if (!admin()) return json({ error: 'auth' }, 401);
        const b = await req.json();
        if (!ID.test(b.id || '') || !b.payload || JSON.stringify(b.payload).length > 4000) return json({ error: 'bad' }, 400);
        const k = 'l:' + b.id, cur = await env.LINKS.get(k, 'json');
        await env.LINKS.put(k, JSON.stringify({ payload: b.payload, created: (cur && cur.created) || Date.now(), n: (cur && cur.n) || 0, first: (cur && cur.first) || 0, last: (cur && cur.last) || 0 }), { expirationTtl: YEAR });
        return json({ ok: true });
      }
      if (req.method === 'GET' && p[0] === 'l' && p.length === 2) {
        if (!ID.test(p[1])) return json({ error: 'nf' }, 404);
        const r = await env.LINKS.get('l:' + p[1], 'json');
        return r ? json({ payload: r.payload }) : json({ error: 'nf' }, 404);
      }
      if (req.method === 'POST' && p[0] === 'o' && p.length === 2) {
        if (!ID.test(p[1])) return json({ error: 'nf' }, 404);
        if (BOT.test(req.headers.get('user-agent') || '')) return json({ ok: true });
        const k = 'l:' + p[1], r = await env.LINKS.get(k, 'json');
        if (!r) return json({ error: 'nf' }, 404);
        const now = Date.now();
        if (now - (r.last || 0) > 60000) {   // a reload within a minute is not a new open
          r.n = (r.n || 0) + 1; if (!r.first) r.first = now; r.last = now;
          await env.LINKS.put(k, JSON.stringify(r), { expirationTtl: YEAR });
        }
        return json({ ok: true });
      }
      if (req.method === 'GET' && p[0] === 's') {
        if (!admin()) return json({ error: 'auth' }, 401);
        const ids = (u.searchParams.get('ids') || '').split(',').filter(x => ID.test(x)).slice(0, 50);
        const out = {};
        await Promise.all(ids.map(async id => { const r = await env.LINKS.get('l:' + id, 'json'); if (r) out[id] = { n: r.n || 0, first: r.first || 0, last: r.last || 0 }; }));
        return json(out);
      }
    } catch (e) { return json({ error: 'err' }, 500); }
    return json({ error: 'nf' }, 404);
  }
};
