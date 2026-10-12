# Fixed-target `git` variant

This is a separate-branch/repository patch for `kbsigmaboy67AtSchool/git`.
It does not require changes to the existing `main` branch.

## What changed

- The proxy destination is read from the server-side Cloudflare Pages
  environment variable `GITHUB_PAGES_TARGET`.
- All requests use that one GitHub Pages destination.
- The `/$/<user-or-domain>` destination override is removed.
- Cookies cannot select or override the destination.
- The target username is not included in this source file, UI, or URL.
- Existing URL paths and query strings are forwarded.

## Deploy

1. Put `functions/[[path]].js` into a separate copy/branch of the project.
2. In Cloudflare Pages, open **Settings → Environment variables**.
3. Add `GITHUB_PAGES_TARGET` with the target GitHub Pages username as its value.
4. Add the variable to both Production and Preview environments as appropriate.
5. Deploy the separate version.

Do not set this variable to a full URL; enter only the GitHub Pages username.
The code validates the value and constructs `https://<username>.github.io`.

## Privacy limits

This prevents the target from being disclosed by this source file and normal app
URLs. It does not make the destination unknowable: GitHub Pages responses,
redirects, page content, or network inspection may reveal the upstream host.
If strict concealment from visitors is required, review redirects and response
content as well. Do not remove security headers or bypass upstream access controls
to try to conceal the destination.

## Important existing middleware note

The existing `functions/_middleware.js` references the original repository to
load DevTools assets. Those references identify the *source repository*, not the
fixed target. They can remain if you want to retain the existing DevTools.
