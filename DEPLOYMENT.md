# Okai Docs Local Demo Harness

This workspace runs two containers with Docker Compose.

## Services

- `editor-engine`: internal Okai Docs editor image built from `editor-engine/server/Dockerfile.level1`.
- `editor-demo-gateway`: local browser/proxy harness built from `editor-demo-gateway/Dockerfile`.

The `editor-engine` image starts from `ghcr.io/euro-office/documentserver:v9.3.1`
by default. It installs the Node.js runtime dependencies required by the local
server sources, copies `Common`, `DocService`, and `FileConverter`, removes
Visio, keeps only PT-BR editor locales/help, merges Okai PT-BR locale overrides
with the Euro-Office base locales, and embeds blank internal welcome/info pages.

The `editor-demo-gateway` image serves the local browser page, restores blank starter files into `/app/files` when needed, signs editor configuration payloads with JWT, and proxies all remaining editor requests to `editor-engine` through the Compose network. The bundled blank files are still only a demo flow. Real document loading, save callbacks, Azure Storage writes, user identity, and platform versioning should live in the host platform integration and be passed to this gateway through a signed launch session.

## Ports

- `127.0.0.1:8093` -> Okai Docs editor demo harness

The editor engine is not published as a host port. Browser traffic goes through the demo harness, which hides engine-only routes from the public surface.

## Configuration

Create a local `.env` file before starting the stack:

```bash
cp .env.example .env
```

`OKD_EDITOR_BASE_IMAGE` defaults to the Euro-Office DocumentServer image used by
this repository. Override it only when intentionally testing another compatible
base. Set `OKD_JWT_SECRET` to a long random value. `OKD_JWT_TTL_SECONDS` controls
the lifetime of editor configuration tokens and defaults to `3600`.
`OKD_FRAME_ANCESTORS` controls which application origins may embed the editor
HTML in an iframe. It defaults to:

```text
'self' http://localhost:* https://localhost:* https://okai.com.br https://app.okai.com.br https://www.okai.com.br https://okaiedgeqa.azurewebsites.net https://okaiedge.azurewebsites.net
```

Add staging application origins there when needed. Do not use
`frame-ancestors *`; keep the list to concrete trusted origins.

The Compose file uses these local configuration names:

- `OKD_EDITOR_BASE_IMAGE`
- `OKD_EDITOR_HOST_INTERNAL_URL`
- `OKD_EDITOR_INTERNAL_URL`
- `OKD_JWT_SECRET`
- `OKD_JWT_TTL_SECONDS`
- `OKD_SESSION_PARAM`
- `OKD_MAX_UPLOAD_BYTES`
- `OKD_FRAME_ANCESTORS`

`OKD_SESSION_PARAM` defaults to `okd_session`. This query parameter carries the
signed host-platform launch token used by `/word`, `/excel`, and `/config/:kind`.
`OKD_MAX_UPLOAD_BYTES` limits brokered dev-session JSON uploads and defaults to
`52428800`.

## Build And Start

From this directory:

```bash
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d --force-recreate
```

On Windows when Docker is available through WSL:

```powershell
wsl.exe -e bash -lc "cd /mnt/c/path/to/okai-docs && docker compose -f docker-compose.yml build"
wsl.exe -e bash -lc "cd /mnt/c/path/to/okai-docs && docker compose -f docker-compose.yml up -d --force-recreate --remove-orphans"
```

## Runtime Layout

The deployment does not mount source files into the runtime containers. Application code and static HTML are baked into the images at build time.

Named volumes are used for mutable runtime data:

- `okai_docs_engine_db`
- `okai_docs_engine_rabbitmq`
- `okai_docs_engine_redis`
- `okai_docs_demo_gateway_files`

## Upstream And Licensing

The default upstream image is Euro-Office DocumentServer:

```text
ghcr.io/euro-office/documentserver:v9.3.1
```

The Okai build overlays only the runtime pieces needed by this deployment. It
keeps the Euro-Office AGPLv3 licensing posture for the packaged runtime while
adding Okai-specific behavior such as iframe headers, brokered temporary saves,
force-save proxying, UI restrictions, PT-BR locale overrides, and icon patches.

The runtime build context intentionally excludes unrelated legacy source trees.
Before publishing a full source package, review any source tree outside the
current Docker build context instead of assuming it inherits this runtime
licensing cleanup automatically.

## Validation

```bash
docker compose -f docker-compose.yml ps
curl -fsS http://127.0.0.1:8093/health
curl -fsS http://127.0.0.1:8093/healthcheck
curl -fsS http://127.0.0.1:8093/config/word
curl -I http://127.0.0.1:8093/word?test=1
curl -I http://127.0.0.1:8093/excel?test=1
```

Useful local URLs:

- `http://127.0.0.1:8093/`
- `http://127.0.0.1:8093/word`
- `http://127.0.0.1:8093/excel`
- `http://127.0.0.1:8093/pdf-readonly`
- `http://127.0.0.1:8093/?kind=cell`
- `http://127.0.0.1:8093/?kind=pdf-edit`
- `http://127.0.0.1:8093/?kind=pdf-comment`

## Public Development Tunnel

The demo harness can be exposed through Cloudflare Tunnel at `https://docs.okai.com.br`.

Set these values in `.env`:

```bash
OKD_PUBLIC_EDITOR_URL=https://docs.okai.com.br
OKD_DEMO_ACCESS_TOKEN=replace-with-a-random-url-safe-token
OKD_DEMO_ACCESS_PARAM=okd_access
OKD_CLOUDFLARE_TUNNEL_ID=optional-existing-tunnel-id-for-service-install
```

Then run:

```powershell
.\Start-OkaiDocsEditorPublic.ps1
```

The first request must include the access parameter. The demo gateway validates it, sets a short-lived HTTP-only cookie, strips the token from the URL, and lets the editor load its assets and websocket traffic normally.

When `OKD_PUBLIC_EDITOR_URL` is set, `OKD_DEMO_ACCESS_TOKEN` is required and must
be a strong random value. The gateway refuses to start public mode with an empty
or short demo access token.

## Host Platform Integration

For a real platform document, the host application should embed the editor with a
signed launch token instead of using the local blank demo file:

```text
https://docs.okai.com.br/word?okd_access=...&okd_session=...
```

The `okd_session` value is an HS256 JWT signed with `OKD_JWT_SECRET`. The payload
must include at least:

```json
{
  "fileUrl": "https://app.example.com/api/okaidocs/file/{documentId}",
  "callbackUrl": "https://app.example.com/api/okaidocs/callback/{documentId}",
  "key": "{documentId}-{version}",
  "title": "Documento.docx",
  "fileType": "docx",
  "documentType": "word"
}
```

For Excel, use `/excel`, `fileType: "xlsx"`, and `documentType: "cell"`.
The `fileUrl` and `callbackUrl` must be reachable from the `editor-engine`
container. A browser-only address such as `https://localhost:7137` usually is not
enough inside Docker; use a host/container-reachable `PlatformBaseUrl`.

The editor config generated from a signed session enables DocumentServer
force-save in the editor UI. The platform callback must handle status `6` for
force-save and status `2` for final save by downloading the edited file from the
callback payload's `url`.

Gateway-managed demo and broker callbacks only download edited files from the
configured editor/gateway hosts. They must not be used as a generic remote URL
fetcher.

A host server can also send a force-save command through this gateway without a
demo cookie by posting a valid command JWT to `/command`:

```json
{
  "c": "forcesave",
  "key": "{documentId}-{version}",
  "token": "<jwt signed over the same c/key payload>"
}
```

The gateway verifies the JWT with `OKD_JWT_SECRET` before proxying the command to
the editor engine.

## Brokered Local-Client Development

When developers run the host platform locally but share this central OkaiDocs
instance, do not point `PlatformBaseUrl` at each developer's `localhost`.
Instead, use the gateway as a broker:

1. The local platform uploads the initial DOCX/XLSX to
   `POST https://docs.okai.com.br/api/dev-sessions`.
2. The gateway stores the file in `okai_docs_demo_gateway_files` and returns an
   `editorUrl`.
3. The platform embeds that `editorUrl`.
4. DocumentServer loads and saves through `/broker/files/{id}` and
   `/broker/callback/{id}`, both hosted by this gateway.
5. The local platform downloads the latest edited file from
   `GET https://docs.okai.com.br/api/dev-sessions/{id}/file`.

Create a brokered session:

```http
POST /api/dev-sessions
Authorization: Bearer <OKD_DEMO_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "kind": "word",
  "title": "Documento.docx",
  "contentBase64": "<optional docx bytes as base64>",
  "user": { "id": "42", "name": "Ana" }
}
```

For Excel, send `"kind": "excel"` or `"kind": "cell"` and an `.xlsx` payload.
If `contentBase64` is omitted, the gateway starts from the bundled blank file.
The response includes `id`, `editorUrl`, `statusUrl`, and `fileUrl`.

Download the edited file:

```http
GET /api/dev-sessions/{id}/file
Authorization: Bearer <OKD_DEMO_ACCESS_TOKEN>
```

If the host platform has its own Save action, call broker force-save first:

```http
POST /api/dev-sessions/{id}/forcesave
Authorization: Bearer <OKD_DEMO_ACCESS_TOKEN>
```

Then poll `statusUrl` until `version` changes or `lastSavedAt` is set before
downloading `fileUrl`.

This flow requires only outbound HTTPS from the developer machine to
`docs.okai.com.br`; no developer Docker or per-developer public tunnel is needed.

For iframe embeds in another application domain, the public access cookie must be issued as `SameSite=None; Secure`. `Start-OkaiDocsEditorPublic.ps1` runs `Test-OkaiDocsEditorPublicAuth.ps1` before starting the tunnel so this does not silently regress.

If `curl -I https://docs.okai.com.br/word?test=1` returns `Cf-Mitigated:
challenge`, that response is being generated by Cloudflare before the request
reaches the gateway. Cloudflare challenge pages include iframe-blocking headers
such as `X-Frame-Options: SAMEORIGIN`, so embeds will still fail until the
Cloudflare rules bypass challenges for the editor host/routes used by the Okai
application.

You can run the same smoke test directly:

```powershell
.\Test-OkaiDocsEditorPublicAuth.ps1
```

To bring the public development endpoint back after a reboot/login, install the startup task:

```powershell
.\Install-OkaiDocsEditorStartupTask.ps1
```

For a machine-level Cloudflare Tunnel service that starts before user login, run PowerShell as Administrator and execute:

```powershell
.\Install-OkaiDocsTunnelService.admin.ps1
```

The service installer resolves the tunnel by `-TunnelName` when possible. For
locked-down service setups, pass `-TunnelId` explicitly or set
`OKD_CLOUDFLARE_TUNNEL_ID` in the environment; keep the credentials JSON in the
local Cloudflare profile, not in this repository.

Expected results:

- `editor-engine` is healthy.
- `editor-demo-gateway` is healthy.
- `/healthcheck` returns `true`.
- `/health` returns `{"ok":true}`.
- `/config/word` returns an editor config with a top-level `token`.
- `/word` and `/excel` do not return `X-Frame-Options`; they do return a
  `Content-Security-Policy` header with the configured `frame-ancestors` list.
