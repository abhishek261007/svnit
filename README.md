# SVNIT Attendance

A read-only attendance web app for SVNIT MIS. It shows subject attendance summaries, highlights values below 75%, estimates how many consecutive present classes would reach 75%, and displays date-wise attendance history.

The frontend is static under `public/`; the production backend is implemented as Cloudflare Pages Functions under `functions/api/`. Login and attendance routes are based on the SVNIT Student Diary API observed in the Android app.

## Local Node server

Requires Node.js 20 or newer:

```sh
npm install
npm run typecheck
npm start
```

Open <http://127.0.0.1:3000>. The local Node server binds only to loopback and keeps the session in memory.

## Preview Cloudflare Pages Functions locally

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars and replace SESSION_SECRET with a strong random value.
# Generate one with: openssl rand -base64 48
npm run dev:pages
```

Open the local Wrangler URL. `.dev.vars` is ignored by Git and must never be committed.

## Deploy to Cloudflare Pages

1. Push this repository to GitHub and create a **Pages** project connected to it.
2. Select **None** as the framework preset, set the build command to `npm run typecheck`, and set the build output directory to `public`.
3. In the Pages project’s **Settings → Variables and Secrets**, add `SESSION_SECRET` as a secret for both Production and Preview. Generate a strong random value, e.g. `openssl rand -base64 48`. Do not put it in source control.
4. Deploy. Pages serves `public/` and automatically routes `/api/*` requests to `functions/api/*`.
5. If this is for personal use, restrict the site with Cloudflare Access. Consider a Cloudflare rate-limit rule for `/api/login` before sharing the URL.

The MIS token is kept only in a short-lived, authenticated AES-GCM encrypted, HttpOnly cookie; it is not returned to browser JavaScript or written to app storage. Login credentials are forwarded by the Pages Function to SVNIT MIS over HTTPS and are not persisted by this app. Cloudflare necessarily processes the function request, so only deploy where you trust the hosting account and operators. Sign out to clear the session cookie.

This unofficial client only performs read-only attendance requests. It is based on observed API behavior and may need changes if the MIS server changes its routes or requirements.
