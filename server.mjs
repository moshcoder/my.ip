// my.ip: your public IPv4 and IPv6 in one answer.
//
// One HTTP request rides one address family, so no server can see both from a
// single connection. Three hosts make up for it:
//
//   my.ip.pit.world    A + AAAA  (dual stack, what people type)
//   4.my.ip.pit.world  A only    (always answers over v4)
//   6.my.ip.pit.world  AAAA only (always answers over v6)
//
// A client that reaches the dual host over v6 (dual-stack clients prefer it) is
// sent once to the v4 host with its v6 address signed into the URL, and that
// response carries both. `curl -L my.ip.pit.world` is therefore one command and
// one answer. Over v4 there is no such hop: a v4-only network cannot reach the
// v6 host, and sending it there would turn "no v6" into a connection error.
// Browsers ask both single-family hosts from the page instead.

import { createServer } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'
import { readFileSync } from 'node:fs'

const SIGNED_FOR_MS = 60_000

export function config(env = process.env) {
  const host = env.MYIP_HOST || 'my.ip.pit.world'
  return {
    port: Number(env.PORT || 8797),
    bind: env.BIND || '127.0.0.1',
    host,
    v4Host: env.MYIP_V4_HOST || `4.${host}`,
    v6Host: env.MYIP_V6_HOST || `6.${host}`,
    // Lost on restart if unset, which only voids redirects already in flight.
    key: env.MYIP_KEY || randomBytes(32).toString('hex'),
    footerUrl: env.MYIP_FOOTER_URL ?? 'https://pit.world/snippets/footer.html?site=my.ip',
  }
}

/** The address as people write it: v4-mapped v6 back to v4, zone ids dropped. */
export function normalizeIp(raw) {
  if (!raw) return null
  let ip = String(raw).trim().split('%')[0]
  if (ip.toLowerCase().startsWith('::ffff:') && isIPv4(ip.slice(7))) ip = ip.slice(7)
  if (isIPv4(ip)) return ip
  if (isIPv6(ip)) return ip.toLowerCase()
  return null
}

export const family = (ip) => (isIPv4(ip) ? 4 : isIPv6(ip) ? 6 : 0)

const mac = (key, fam, ip, exp) =>
  createHmac('sha256', key).update(`${fam}|${ip}|${exp}`).digest('base64url').slice(0, 22)

export function sign(key, fam, ip, now = Date.now()) {
  const exp = now + SIGNED_FOR_MS
  return { exp: String(exp), sig: mac(key, fam, ip, exp) }
}

/** The other family's address carried in the query, if we signed it and it is fresh. */
export function carried(key, params, now = Date.now()) {
  const exp = Number(params.get('exp'))
  const sig = params.get('sig') || ''
  if (!exp || exp < now || exp > now + SIGNED_FOR_MS) return {}
  const out = {}
  for (const fam of [4, 6]) {
    const ip = normalizeIp(params.get(`v${fam}`))
    if (!ip || family(ip) !== fam) continue
    const want = Buffer.from(mac(key, fam, ip, exp))
    const got = Buffer.from(sig)
    if (want.length === got.length && timingSafeEqual(want, got)) out[`ipv${fam}`] = ip
  }
  return out
}

export function pickFormat(url, accept = '') {
  const f = (url.searchParams.get('format') || '').toLowerCase()
  if (f === 'json' || f === 'text' || f === 'html') return f
  if (url.pathname === '/json') return 'json'
  if (url.pathname === '/text') return 'text'
  if (/application\/json/i.test(accept)) return 'json'
  if (/text\/html/i.test(accept)) return 'html'
  return 'text'
}

export const asText = (r) => `v4: ${r.ipv4 ?? 'none'}\nv6: ${r.ipv6 ?? 'none'}\n`
export const asJson = (r) => JSON.stringify({ ip: r.ip, ipv4: r.ipv4, ipv6: r.ipv6 }) + '\n'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const ringRow = (() => {
  try { return readFileSync(new URL('./public/footer.html', import.meta.url), 'utf8') } catch { return '' }
})()

// pit.world's footer, fetched server-side and kept for an hour; nothing on error.
let pitFooter = { html: '', at: 0 }
async function footer(cfg) {
  if (!cfg.footerUrl) return ''
  if (Date.now() - pitFooter.at < 3_600_000) return pitFooter.html
  try {
    const res = await fetch(cfg.footerUrl, { signal: AbortSignal.timeout(3000) })
    const html = res.ok ? await res.text() : ''
    if (html.includes('data-pit-footer') || !pitFooter.html) pitFooter = { html, at: Date.now() }
  } catch {
    pitFooter.at = Date.now() - 3_000_000 // try again in ten minutes
  }
  return pitFooter.html
}

export function page(r, cfg, foot = '') {
  const known = JSON.stringify({ ipv4: r.ipv4, ipv6: r.ipv6 }).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>my.ip</title><meta name="description" content="Your public IPv4 and IPv6 in one answer. curl -L ${esc(cfg.host)}">
<style>
:root{--bg:#f6f7f2;--fg:#151812;--mute:#5d6655;--line:#d5dacb;--accent:#3d7a00;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#070806;--fg:#edf2e4;--mute:#97a18b;--line:#273021;--accent:#a6ff1a;--card:#0f120d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
main{max-width:720px;margin:0 auto;padding:10vh 16px 48px}h1{color:var(--accent);font-size:1.6rem;margin:0 0 24px}
.ip{display:grid;grid-template-columns:3ch 1fr auto;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 10px}
.ip b{color:var(--mute);font-weight:400}.ip code{font-size:1.15rem;overflow-wrap:anywhere}
button{font:inherit;font-size:.85rem;background:none;color:var(--accent);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto;color:var(--mute)}
p{color:var(--mute)}
</style></head><body><main>
<h1>my.ip</h1>
<div class="ip"><b>v4</b><code id="v4">${esc(r.ipv4 ?? 'checking…')}</code><button data-copy="v4">copy</button></div>
<div class="ip"><b>v6</b><code id="v6">${esc(r.ipv6 ?? 'checking…')}</code><button data-copy="v6">copy</button></div>
<p>Both addresses, one answer. Add both to an allowlist: a dual-stack machine often connects over v6.</p>
<pre>curl -L ${esc(cfg.host)}                # v4: … / v6: …
curl -L '${esc(cfg.host)}/?format=json' # {"ip":…,"ipv4":…,"ipv6":…}
curl ${esc(cfg.v4Host)}              # v4 only
curl ${esc(cfg.v6Host)}              # v6 only</pre>
</main>
<script>
const known=${known};
const ask=async(h)=>{try{const r=await fetch('https://'+h+'/?format=json',{cache:'no-store'});return (await r.json()).ip}catch{return null}};
const show=(id,v)=>{document.getElementById(id).textContent=v||'none'};
ask(${JSON.stringify(cfg.v4Host)}).then(v=>show('v4',v||known.ipv4));
ask(${JSON.stringify(cfg.v6Host)}).then(v=>show('v6',v||known.ipv6));
document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent));
</script>
${ringRow}${foot}
</body></html>`
}

/** Answer one request. `remote` is the visitor's address as nginx saw it. */
export async function answer({ url, accept, remote, hostHeader }, cfg, now = Date.now()) {
  const headers = {
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    vary: 'accept',
  }
  if (url.pathname === '/health') return { status: 200, headers: { ...headers, 'content-type': 'text/plain' }, body: 'ok\n' }
  if (!['/', '/json', '/text'].includes(url.pathname)) {
    return { status: 404, headers: { ...headers, 'content-type': 'text/plain' }, body: 'not found\n' }
  }

  const ip = normalizeIp(remote)
  const fam = family(ip)
  const r = { ip, ipv4: fam === 4 ? ip : null, ipv6: fam === 6 ? ip : null, ...carried(cfg.key, url.searchParams, now) }
  r[`ipv${fam}`] = ip // the connection itself always wins over anything carried
  const fmt = pickFormat(url, accept)
  const host = String(hostHeader || '').split(':')[0].toLowerCase()
  const singleFamily = host === cfg.v4Host || host === cfg.v6Host

  if (fmt === 'html') {
    return { status: 200, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' }, body: page(r, cfg, await footer(cfg)) }
  }

  const body = fmt === 'json' ? asJson(r) : asText(r)
  const type = fmt === 'json' ? 'application/json' : 'text/plain; charset=utf-8'

  if (fam === 6 && !r.ipv4 && !singleFamily) {
    const { exp, sig } = sign(cfg.key, 6, ip, now)
    const next = new URL(`https://${cfg.v4Host}${url.pathname}`)
    for (const [k, v] of url.searchParams) if (!['v4', 'v6', 'exp', 'sig'].includes(k)) next.searchParams.set(k, v)
    next.searchParams.set('v6', ip)
    next.searchParams.set('exp', exp)
    next.searchParams.set('sig', sig)
    // The body is the half we know, so a curl without -L still prints something true.
    return { status: 302, headers: { ...headers, 'content-type': type, location: next.toString() }, body }
  }
  return { status: 200, headers: { ...headers, 'content-type': type }, body }
}

export function serve(cfg = config()) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${cfg.host}`)
      // nginx is the only thing that can reach us (127.0.0.1 bind), and it sets X-Real-IP.
      const remote = req.headers['x-real-ip'] || req.socket.remoteAddress
      const out = await answer({ url, accept: req.headers.accept || '', remote, hostHeader: req.headers['x-forwarded-host'] || req.headers.host }, cfg)
      res.writeHead(out.status, out.headers)
      res.end(req.method === 'HEAD' ? undefined : out.body)
    } catch (err) {
      console.error(err)
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('error\n')
    }
  })
  server.listen(cfg.port, cfg.bind, () => console.log(`my.ip on ${cfg.bind}:${cfg.port} for ${cfg.host}`))
  return server
}

if (import.meta.url === `file://${process.argv[1]}`) serve()
