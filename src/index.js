/**
 * Eaglercraft-compatible WSS relay bridge for Cloudflare Workers.
 *
 * Routes:
 *   wss://YOUR-WORKER.example/relay/deev/
 *   wss://YOUR-WORKER.example/relay/lax1dude/
 *   wss://YOUR-WORKER.example/relay/shhnow/
 *
 * Configure EAGLER_RELAYS_JSON as a server-side Worker variable, e.g.:
 * {
 *   "deev": "wss://relay.deev.is/",
 *   "lax1dude": "wss://relay.lax1dude.net/",
 *   "shhnow": "wss://relay.shhnowisnottheti.me/"
 * }
 *
 * Only configured relay IDs can be used. This is not an arbitrary-host proxy.
 * The incoming Origin is forwarded as-is; it is not spoofed to evade relay
 * origin whitelists.
 */

const ID_RE = /^[a-z0-9-]{1,40}$/;

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function parseRelayMap(env) {
  let value;
  try {
    value = JSON.parse(env.EAGLER_RELAYS_JSON || "{}");
  } catch {
    throw new Error("EAGLER_RELAYS_JSON is not valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EAGLER_RELAYS_JSON must be a JSON object");
  }

  const result = new Map();
  for (const [id, raw] of Object.entries(value)) {
    if (!ID_RE.test(id) || typeof raw !== "string") continue;

    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }

    // Require secure WebSocket destinations and reject URL credentials.
    if (
      url.protocol !== "wss:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      continue;
    }

    result.set(id, url);
  }
  return result;
}

function buildUpstream(base, restPath, search) {
  const upstream = new URL(base.toString());
  const basePath = upstream.pathname.replace(/\/+$/, "");
  const suffix = restPath ? `/${restPath.replace(/^\/+/, "")}` : "";
  upstream.pathname = `${basePath}${suffix}` || "/";
  upstream.search = search;
  upstream.hash = "";
  return upstream;
}

function isWebSocketUpgrade(request) {
  return (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);

    if (request.method === "GET" && incoming.pathname === "/") {
      return new Response(
        "Eagler WSS proxy is online. Connect to /relay/<configured-id>/",
        {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }

    const match = incoming.pathname.match(/^\/relay\/([a-z0-9-]{1,40})(?:\/(.*))?$/);
    if (!match) {
      return jsonError("Use /relay/<configured-relay-id>/", 404);
    }

    if (!isWebSocketUpgrade(request)) {
      return jsonError("A WebSocket Upgrade request is required.", 426);
    }

    let relayMap;
    try {
      relayMap = parseRelayMap(env);
    } catch {
      return jsonError("Proxy relay configuration is invalid.", 503);
    }

    const relayId = match[1];
    const base = relayMap.get(relayId);
    if (!base) {
      return jsonError("This relay ID is not configured.", 404);
    }

    const restPath = match[2] || "";
    const upstreamURL = buildUpstream(base, restPath, incoming.search);

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Upgrade", "websocket");

    // Eaglercraft clients commonly request "binary". Forward the requested
    // subprotocol so the relay can negotiate it; never invent a protocol.
    const protocols = request.headers.get("Sec-WebSocket-Protocol");
    if (protocols) upstreamHeaders.set("Sec-WebSocket-Protocol", protocols);

    // Forward the actual proxy-page origin. Do not impersonate another site.
    const origin = request.headers.get("Origin");
    if (origin) upstreamHeaders.set("Origin", origin);

    // Deliberately do not forward browser cookies, Authorization, or arbitrary
    // client-provided host/forwarding headers to the upstream.
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamURL.toString(), {
        method: "GET",
        headers: upstreamHeaders,
        redirect: "manual",
      });
    } catch {
      return jsonError("Could not connect to the configured relay.", 502);
    }

    const upstreamSocket = upstreamResponse.webSocket;
    if (!upstreamSocket) {
      // Keep upstream internals private; report only a generic failure.
      return jsonError(
        upstreamResponse.status >= 400
          ? "The relay rejected the WebSocket handshake."
          : "The relay did not accept a WebSocket upgrade.",
        upstreamResponse.status >= 400 ? upstreamResponse.status : 502,
      );
    }

    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const bridgeSocket = pair[1];

    // Use half-open mode so close events can be coordinated on both sides.
    bridgeSocket.accept({ allowHalfOpen: true });
    upstreamSocket.accept({ allowHalfOpen: true });

    // Eaglercraft sends binary frames; arraybuffer preserves binary payloads.
    bridgeSocket.binaryType = "arraybuffer";
    upstreamSocket.binaryType = "arraybuffer";

    const closeBoth = (code = 1000, reason = "") => {
      const safeReason = String(reason).slice(0, 120);
      for (const socket of [bridgeSocket, upstreamSocket]) {
        try {
          if (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING ||
            socket.readyState === WebSocket.CLOSING
          ) {
            socket.close(code, safeReason);
          }
        } catch {}
      }
    };

    const forward = (from, to) => {
      from.addEventListener("message", event => {
        try {
          if (to.readyState === WebSocket.OPEN) {
            to.send(event.data);
          } else {
            closeBoth(1011, "Relay connection unavailable");
          }
        } catch {
          closeBoth(1011, "WebSocket forwarding error");
        }
      });

      from.addEventListener("close", event => {
        const code = Number.isInteger(event.code) ? event.code : 1000;
        closeBoth(code, event.reason || "");
      });

      from.addEventListener("error", () => {
        closeBoth(1011, "WebSocket relay error");
      });
    };

    forward(bridgeSocket, upstreamSocket);
    forward(upstreamSocket, bridgeSocket);

    const selectedProtocol =
      upstreamResponse.headers.get("Sec-WebSocket-Protocol");
    if (
      selectedProtocol &&
      protocols &&
      protocols.split(",").map(x => x.trim()).includes(selectedProtocol)
    ) {
      // The selected protocol is returned by the upstream handshake.
      // It must be a protocol the client originally requested.
      return new Response(null, {
        status: 101,
        webSocket: clientSocket,
        headers: { "Sec-WebSocket-Protocol": selectedProtocol },
      });
    }

    if (selectedProtocol) {
      closeBoth(1002, "Unexpected WebSocket subprotocol");
      return jsonError("Relay selected an unrequested subprotocol.", 502);
    }

    return new Response(null, { status: 101, webSocket: clientSocket });
  },
};
