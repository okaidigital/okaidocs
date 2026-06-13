# Editor Demo Gateway

This directory contains the local demo harness used to test editor builds and UI changes.

It is not the production document integration layer. The production platform should provide its own document URLs, callback URLs, user identity, permissions, Azure Storage persistence, and product versioning.

The harness keeps a small local flow:

- serves the browser shell at `/`;
- serves direct bare editor routes at `/word`, `/excel`, and `/pdf-readonly`;
- builds signed editor configs at `/config/:kind`;
- serves bundled blank starter files from `/files/:filename`;
- accepts editor callbacks at `/callback/:filename`;
- proxies editor engine routes to `editor-engine`;
- optionally accepts a signed `okd_session` launch token so a host platform can
  provide its own `fileUrl`, `callbackUrl`, document key, user, and permissions;
- optionally brokers dev sessions through `/api/dev-sessions`, storing the
  current DOCX/XLSX/PPTX in this service so local client machines do not need Docker
  or inbound tunnels.

The editor shell routes (`/`, `/word`, `/excel`, `/cell`, `/pdf-edit`,
`/pdf-comment`, and `/pdf-readonly`) and proxied editor HTML responses remove
`X-Frame-Options` and send a restrictive `Content-Security-Policy`
`frame-ancestors` directive instead. The default allows this service, localhost
on any development port, and the Okai application hosts:

```text
'self' http://localhost:* https://localhost:* https://okai.com.br https://app.okai.com.br https://www.okai.com.br https://okaiedgeqa.azurewebsites.net https://okaiedge.azurewebsites.net
```

Override `OKD_FRAME_ANCESTORS` when a staging application origin also needs to
embed the editor. Do not use `frame-ancestors *`.

For public development exposure, set `OKD_PUBLIC_EDITOR_URL`, `OKD_DEMO_ACCESS_TOKEN`, and `OKD_DEMO_ACCESS_PARAM`.
The first browser request should include the configured access parameter; the gateway exchanges it for an HTTP-only cookie and removes the token from the visible URL.

## Host Platform Sessions

Use `okd_session` when the editor iframe must open or save a real platform
document instead of the local blank demo file. The value must be an HS256 JWT
signed with `OKD_JWT_SECRET`. Do not put secrets in the token payload; JWTs are
signed, not encrypted.

Example payload:

```json
{
  "documentId": "8f5d...",
  "fileUrl": "https://app.example.com/api/okaidocs/file/8f5d...",
  "callbackUrl": "https://app.example.com/api/okaidocs/callback/8f5d...",
  "key": "8f5d-v12",
  "title": "Ata.docx",
  "fileType": "docx",
  "documentType": "word",
  "user": { "id": "42", "name": "Ana" }
}
```

Then embed:

```text
https://docs.okai.com.br/word?okd_access=...&okd_session=...
```

For spreadsheets use `/excel`, `fileType: "xlsx"`, and `documentType: "cell"`.
The platform URLs must be reachable from the editor container, not only from the
user's browser. When the user clicks Save, the editor sends a force-save callback
to the platform. When the editing session closes, it sends the final save
callback as well.

Server-to-server force-save can be sent through this gateway at `/command`
without the demo cookie, provided the command body contains a valid JWT signed
with `OKD_JWT_SECRET`:

```json
{
  "c": "forcesave",
  "key": "8f5d-v12",
  "token": "<jwt signed over the same c/key payload>"
}
```

## Brokered Dev Sessions

Use this when the editor is centralized at `docs.okai.com.br`, but each developer
runs the host platform locally. The client uploads the initial document to this
gateway, opens the returned `editorUrl`, and downloads the edited file from this
gateway later. The DocumentServer container never has to reach the developer machine.

Create a session:

```http
POST /api/dev-sessions
Authorization: Bearer <OKD_DEMO_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "kind": "word",
  "title": "Ata.docx",
  "contentBase64": "<optional docx bytes as base64>",
  "user": { "id": "42", "name": "Ana" }
}
```

For Excel, send `"kind": "excel"` or `"kind": "cell"` and an `.xlsx` payload.
If `contentBase64` is omitted, the gateway starts from its bundled blank file.
For PowerPoint, send `"kind": "presentation"` or `"kind": "pptx"` and a
`.pptx` payload.

When `documentId` is provided, active brokered sessions are idempotent per
`documentId` and normalized `kind`. A second `POST /api/dev-sessions` for the
same active document reuses the existing gateway session, keeps the same
DocumentServer `document.key`, ignores any new `contentBase64`, and returns an
`editorUrl` signed for the current user. The session is considered closed after
a DocumentServer final-save callback with status `2`; a later open starts a new
DocumentServer key and initializes from the prior consolidated file when no fresh
`contentBase64` is provided.

The response includes:

```json
{
  "id": "...",
  "editorUrl": "https://docs.okai.com.br/word?...",
  "statusUrl": "https://docs.okai.com.br/api/dev-sessions/{id}",
  "fileUrl": "https://docs.okai.com.br/api/dev-sessions/{id}/file"
}
```

Download the latest edited file with:

```http
GET /api/dev-sessions/{id}/file
Authorization: Bearer <OKD_DEMO_ACCESS_TOKEN>
```

If the host platform has its own Save button, it can first ask the editor to
flush the current document:

```http
POST /api/dev-sessions/{id}/forcesave
Authorization: Bearer <OKD_DEMO_ACCESS_TOKEN>
```

Then poll `statusUrl` until `version` changes or `lastSavedAt` is set before
downloading `fileUrl`.

Force-save calls are serialized per broker session. If DocumentServer refuses the
command, the gateway returns a structured JSON result with `ok: false`, the
upstream HTTP status, and the raw DocumentServer result for diagnostics.

The gateway accepts DocumentServer callbacks internally at `/broker/callback/{id}`
and persists status `6` force-save and status `2` final-save results into the
session file. Status `7` is recorded as a save error without replacing the
current consolidated file.

Keep changes here focused on local validation, visual testing, and editor customization experiments.
