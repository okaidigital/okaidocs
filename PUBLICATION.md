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

## Remaining Release Steps

1. Run a tracked-file and history secret scan before the first public push.
2. If publishing from the existing Git history, review any findings from old
   commits; otherwise publish from a fresh repository initialized from this
   pruned working tree.
3. Include AGPLv3 license text, attribution notices, and source-offer notes for
   modified AGPL components.
4. Keep the repository private until the scan is clean.

Useful upstream references:

- https://github.com/Euro-Office/DocumentServer
- https://nextcloud.com/blog/euro-office-license-compliance-and-what-open-source-means/
