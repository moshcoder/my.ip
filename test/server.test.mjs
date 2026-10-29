import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answer, carried, config, normalizeIp, pickFormat, sign } from '../server.mjs'

const cfg = { ...config({ MYIP_KEY: 'k' }), footerUrl: '' }
const ask = (path, remote, extra = {}) =>
  answer({ url: new URL(path, 'http://x'), accept: '', remote, hostHeader: 'my.ip.pit.world', ...extra }, cfg)

test('normalizes v4-mapped and zoned addresses', () => {
  assert.equal(normalizeIp('::ffff:2.56.246.141'), '2.56.246.141')
  assert.equal(normalizeIp('2A0E::1%eth0'), '2a0e::1')
  assert.equal(normalizeIp('nope'), null)
})

test('v4 visitor gets v4 and no v6, no redirect', async () => {
  const r = await ask('/', '2.56.246.141')
  assert.equal(r.status, 200)
  assert.equal(r.body, 'v4: 2.56.246.141\nv6: none\n')
})

test('v6 visitor on the dual host is sent to the v4 host with a signed v6', async () => {
  const r = await ask('/?format=json', '2a0e:97c0:3ea:3a7::1')
  assert.equal(r.status, 302)
  const next = new URL(r.headers.location)
  assert.equal(next.host, '4.my.ip.pit.world')
  assert.equal(next.searchParams.get('format'), 'json')
  assert.deepEqual(JSON.parse(r.body), { ip: '2a0e:97c0:3ea:3a7::1', ipv4: null, ipv6: '2a0e:97c0:3ea:3a7::1' })

  const merged = await ask(next.pathname + next.search, '2.56.246.141', { hostHeader: '4.my.ip.pit.world' })
  assert.equal(merged.status, 200)
  assert.deepEqual(JSON.parse(merged.body), { ip: '2.56.246.141', ipv4: '2.56.246.141', ipv6: '2a0e:97c0:3ea:3a7::1' })
})

test('single-family hosts never redirect', async () => {
  const r = await ask('/', '2a0e::1', { hostHeader: '6.my.ip.pit.world' })
  assert.equal(r.status, 200)
  assert.equal(r.body, 'v4: none\nv6: 2a0e::1\n')
})

test('unsigned, forged or stale carried addresses are ignored', () => {
  const now = Date.now()
  const { exp, sig } = sign('k', 6, '2a0e::1', now)
  const p = (o) => new URLSearchParams(o)
  assert.deepEqual(carried('k', p({ v6: '2a0e::1', exp, sig }), now), { ipv6: '2a0e::1' })
  assert.deepEqual(carried('k', p({ v6: '2a0e::2', exp, sig }), now), {})
  assert.deepEqual(carried('other', p({ v6: '2a0e::1', exp, sig }), now), {})
  assert.deepEqual(carried('k', p({ v6: '2a0e::1', exp, sig }), now + 61_000), {})
  assert.deepEqual(carried('k', p({ v4: '2a0e::1', exp, sig }), now), {})
})

test('the connection wins over a carried address of the same family', async () => {
  const { exp, sig } = sign(cfg.key, 4, '9.9.9.9')
  const r = await ask(`/?v4=9.9.9.9&exp=${exp}&sig=${sig}`, '2.56.246.141')
  assert.equal(r.body, 'v4: 2.56.246.141\nv6: none\n')
})

test('format from query, path, then Accept', () => {
  const u = (s) => new URL(s, 'http://x')
  assert.equal(pickFormat(u('/?format=json')), 'json')
  assert.equal(pickFormat(u('/json')), 'json')
  assert.equal(pickFormat(u('/'), 'application/json'), 'json')
  assert.equal(pickFormat(u('/'), 'text/html,*/*'), 'html')
  assert.equal(pickFormat(u('/'), '*/*'), 'text')
})

test('html escapes and embeds both hosts', async () => {
  const r = await ask('/?format=html', '2.56.246.141')
  assert.match(r.body, /4\.my\.ip\.pit\.world/)
  assert.match(r.body, /<code id="v4">2\.56\.246\.141<\/code>/)
})

test('unknown paths 404', async () => {
  assert.equal((await ask('/admin', '2.56.246.141')).status, 404)
})
