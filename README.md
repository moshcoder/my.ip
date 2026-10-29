# my.ip

Your public IPv4 **and** IPv6 in one answer.

```sh
$ curl -L my.ip.pit.world
v4: 2.56.246.141
v6: 2a0e:97c0:3ea:3a7::1

$ curl -L 'my.ip.pit.world/?format=json'
{"ip":"2.56.246.141","ipv4":"2.56.246.141","ipv6":"2a0e:97c0:3ea:3a7::1"}
```

Also the Moshpit name `my.ip`, and a page for browsers at https://my.ip.pit.world.

## Why the `-L`

One HTTP request rides one address family, so no server can see both from one
connection. Three hosts make up for it:

| host | DNS | answers over |
| --- | --- | --- |
| `my.ip.pit.world` | A + AAAA | whichever your machine picks |
| `4.my.ip.pit.world` | A | IPv4 only |
| `6.my.ip.pit.world` | AAAA | IPv6 only |

A dual-stack machine reaches `my.ip.pit.world` over v6, gets one redirect to the
v4 host with its v6 address signed into the URL (HMAC, 60 s), and that response
carries both. A v4-only machine gets `v6: none` straight away. Without `-L` you
still get the half that was seen.

Formats: `?format=json|text|html`, `/json`, `/text`, or `Accept: application/json`.
Default is text; browsers get HTML. CORS is open.

## CLI

`bin/myip` asks the two single-family hosts (falls back to ipify, then icanhazip):

```sh
myip            # v4: … / v6: …
myip --json     # {"ipv4":…,"ipv6":…}
myip -4 / -6    # one bare address
```

## Run

```sh
npm test
PORT=8797 MYIP_KEY=$(openssl rand -hex 32) node server.mjs   # behind nginx, which sets X-Real-IP
deploy/deploy.sh                                             # dev3: rsync, systemd (node:24-alpine), nginx
```

Hosted on dev3, the fleet box with IPv6. No dependencies.
