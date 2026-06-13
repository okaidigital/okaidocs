# Public Repository Checklist

This repository is shaped to be publishable as a slim source tree for the Okai
Docs editor runtime.

The Docker runtime path has been moved to Euro-Office DocumentServer and the
current image build context is intentionally narrow. Legacy vendored editor
trees that were not part of the runtime overlay have been removed from the
working tree.

## Public Tree Shape

- Root deployment scripts and documentation.
- `docker-compose.yml`, `.env.example`, and local validation scripts.
- `editor-demo-gateway`.
- The runtime overlay files included by `editor-engine/.dockerignore`.
- `editor-engine/server/Dockerfile.level1`.

## Removed From The Public Tree

- Legacy editor source trees that were not copied by the Docker build.
- Broad `web-apps` content outside the runtime patch files copied by the
  Dockerfile.
- Old runtime image packaging that is no longer used by this stack.
- Generated deployment packages, local test artifacts, and package checksums.

## Product Security Notes

- Do not publish `.env`, `.cloudflared`, generated deployment packages, logs, or
  runtime document files.
- Keep machine-specific deployment overrides in ignored files such as `.env`,
  `.env.local`, `docker-compose.override.yml`, or CI/CD secrets.
- `OKD_PUBLIC_EDITOR_URL` requires a strong `OKD_DEMO_ACCESS_TOKEN`; the gateway
  refuses to start public mode without one.
- Callback downloads are restricted to the configured editor/gateway hosts so the
  public gateway cannot be used as a generic URL fetcher.
- Treat the demo access token and `OKD_JWT_SECRET` as production secrets. Rotate
  them if they ever appeared in Git history, logs, tickets, screenshots, or chat.
- Prefer publishing from a fresh, pruned repository if there is any doubt about
  old history.

## Public And Internal In The Same Repository

The public repository can stay internally functional as long as all
environment-specific values live outside Git. The committed tree should contain
the reproducible source, Dockerfiles, scripts, docs, and example configuration;
the internal machine or deployment pipeline supplies secrets and local overrides.

Use this split:

- Public Git: runtime overlay source, gateway source, Docker Compose, build
  scripts, validation scripts, README, deployment docs, and `.env.example`.
- Private runtime state: real `.env`, Cloudflare credentials, tunnel service
  files, logs, generated deployment packages, runtime document files, and Docker
  volumes.
- Optional private operations layer: CI/CD secrets, machine service config, and
  deployment-specific override files ignored by Git.

This lets the same checkout build and run internally while also serving as the
AGPL source publication for the modified editor stack.

## Publication Status

The initial public repository was published from a fresh Git history initialized
from the pruned runtime tree. The old local history is intentionally not part of
the public repository.

Before the initial public push, the current source tree was checked with:

- `gitleaks dir` against the pruned working tree.
- `node --check editor-demo-gateway/server.js`.
- `docker compose build --no-cache` with a placeholder local
  `OKD_JWT_SECRET`.

## Ongoing Release Hygiene

1. Run a tracked-file secret scan before public pushes that add configuration,
   scripts, logs, generated files, or binary artifacts.
2. Keep `.env`, `.cloudflared`, generated deployment packages, local document
   sessions, logs, and Docker override files out of Git.
3. Do not import the old local Git history into the public repository unless it
   is rewritten and scanned separately.
4. When adding new upstream source trees or runtime patches, update `NOTICE.md`
   and verify that the committed source still corresponds to the deployed
   modified AGPL runtime.

Useful upstream references:

- https://github.com/Euro-Office/DocumentServer
- https://nextcloud.com/blog/euro-office-license-compliance-and-what-open-source-means/
