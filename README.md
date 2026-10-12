# Eaglercraft WSS proxy for Cloudflare Workers
 
A fixed-destination WebSocket bridge for Eaglercraft-compatible relay endpoints.

## Why Workers?

Cloudflare Workers has documented support for incoming WebSocket upgrades and outbound WebSocket connections. A standalone Worker is the recommended deployment target for this version because WebSocket bridging is its main job. Pages Functions run on the Workers runtime, but validate WebSocket behavior in your exact Pages setup before using it there.

## Routes

Given a Worker domain `eagler-wss-proxy.example.workers.dev`, configured relay IDs are accessed as:

- `wss://eagler-wss-proxy.example.workers.dev/relay/deev/`
- `wss://eagler-wss-proxy.example.workers.dev/relay/lax1dude/`
- `wss://eagler-wss-proxy.example.workers.dev/relay/shhnow/`

The `EAGLER_RELAYS_JSON` variable maps each ID to a fixed `wss://` URL. Client requests cannot choose arbitrary hostnames. Optional path suffixes and query strings are forwarded to the configured destination.

## Configure

In Cloudflare Dashboard → Workers & Pages → your Worker → Settings → Variables and Secrets, add a **text variable** named `EAGLER_RELAYS_JSON` with a JSON value such as:

    {"deev":"wss://relay.deev.is/","lax1dude":"wss://relay.lax1dude.net/","shhnow":"wss://relay.shhnowisnottheti.me/"}

These are example public relay endpoints, not an assertion that they currently accept proxied traffic. Configure only endpoints you are permitted to use. The variable is server-side; it is not injected into browser JavaScript.

You can also deploy with Wrangler:

    npm install -g wrangler
    wrangler login
    wrangler deploy

Then set `EAGLER_RELAYS_JSON` in the Cloudflare dashboard, or configure it as a Wrangler variable appropriate to your workflow.

## Eaglercraft notes

- Eaglercraft clients commonly request the `binary` WebSocket subprotocol. This Worker forwards the client's requested subprotocol and only returns an upstream-selected protocol if the client requested it.
- Binary and text messages are forwarded in both directions.
- The incoming `Origin` header is passed through unchanged. For a browser connection to this Worker, that origin will normally be your proxy/client page's origin.
- If a relay rejects your domain due to its origin whitelist, request permission from its operator or use a relay that permits your domain. This project does not spoof origins, remove origin checks, or otherwise evade a relay's whitelist.
- Some relays have additional rules, protocol requirements, rate limits, IP controls, or deployment restrictions. A successful WebSocket handshake alone does not guarantee Eaglercraft multiplayer will work end to end.
- Cloudflare Workers WebSocket messages have a documented size limit (currently 32 MiB per message). This is unlikely for ordinary game packets but is a runtime limit to keep in mind.
- This patch has not been deployed or tested against these public relays. Their availability and policies can change.

## Security and abuse controls

This is intentionally not an open proxy:
- Only IDs configured in `EAGLER_RELAYS_JSON` can be selected.
- Arbitrary upstream hosts from query strings, path segments, or headers are not accepted.
- Cookies and arbitrary authorization headers are not forwarded.
- Origin is not spoofed.
- Add Cloudflare rate limiting or other abuse protections before sharing a public proxy.

## Pages Functions option

The core handler uses Workers APIs. It may be adapted into a Pages Function, but test WebSocket upgrade behavior and your deployment configuration first. For the simplest supported path, deploy as a standalone Worker.
