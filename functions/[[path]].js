/**
 * Fixed-target GitHub Pages proxy.
 *
 * Cloudflare Pages environment variable:
 *   GITHUB_PAGES_TARGET = the GitHub Pages username to proxy to
 *
 * Configure GITHUB_PAGES_TARGET in Cloudflare Pages -> Settings ->
 * Environment variables. Do not put the target username in source code.
 *
 * This function intentionally does not support user/domain overrides.
 */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const targetUser = String(env.GITHUB_PAGES_TARGET || "").trim();

  // Validate the private configuration before constructing the URL.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(targetUser)) {
    return new Response("Fixed destination is not configured.", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // Never allow request paths, query parameters, or cookies to select a host.
  const target = new URL(`https://${targetUser}.github.io`);
  target.pathname = url.pathname || "/";
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.delete("Forwarded");
  headers.delete("X-Forwarded-Host");
  headers.delete("X-Forwarded-Proto");

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    });
  } catch {
    return new Response("The fixed destination could not be reached.", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // Do not set a target-selection cookie. The target is fixed by server config.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("Set-Cookie");
  responseHeaders.set("Cache-Control", responseHeaders.get("Cache-Control") || "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
