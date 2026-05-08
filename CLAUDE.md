# Monocle (Aligent fork)

Aligent-specific notes for working in this fork. Upstream docs apply unless overridden here.

## Running the stack locally

Full instructions are in **[README.md → Local development quickstart](README.md#local-development-quickstart)** (kept canonical there). Brief summary:

- Stack is `docker compose` with services `api` (8080), `crawler`, `elastic`, `alt-frontend` (3001).
- The compose file uses the `quay.io/change-metrics/monocle` image path, but our CI publishes to `ghcr.io/aligent/monocle:dev` — so refreshing to a new build is `docker pull ghcr.io/aligent/monocle:dev && docker tag ghcr.io/aligent/monocle:dev quay.io/change-metrics/monocle:dev && docker compose up -d --force-recreate api crawler`.
- If `api` crashloops on startup with `cluster_block_exception ... disk usage exceeded flood-stage watermark`, the ES data volume is full enough to have read-only-locked the indices. README has the two PUT calls that recover it.

## Alt-frontend dashboard

`alt-frontend/` is a vanilla-JS + Chart.js dashboard, served by an `nginx:alpine` compose service on port 3001. Edits are live (bind-mounted, `Cache-Control: no-store` via `alt-frontend/nginx.conf`) — no rebuild required for UI changes. API URL and workspace are configurable from the page (persisted in `localStorage`); no env vars are injected at build time.

Backend metric changes still require an image rebuild via the CI flow above.
