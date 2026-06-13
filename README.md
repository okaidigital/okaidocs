# Okai Docs

Okai Docs is the local editor integration harness used by Okai for iframe embedding,
temporary brokered document sessions, force-save validation, and UI customization
work.

The editor engine is built on top of the Euro-Office DocumentServer image:

```text
ghcr.io/euro-office/documentserver:v9.3.1
```

Euro-Office is used as the upstream base because it publishes DocumentServer under
AGPLv3 without the extra logo/trademark clauses that existed in the previous
upstream lineage. Okai-specific changes are layered on top at build time: iframe
headers, JWT signing, brokered temporary saves, plugin/AI disablement, PT-BR
locales, ribbon icon overrides, UI restrictions, blank internal pages, and Visio
removal.

## Quick Start

Create a local `.env` from the example and set a strong `OKD_JWT_SECRET`:

```powershell
Copy-Item .env.example .env
```

Start the local stack:

```powershell
.\Start-OkaiDocsEditorLocal.ps1 -Build
```

Local URLs:

- `http://127.0.0.1:8093/word`
- `http://127.0.0.1:8093/excel`
- `http://127.0.0.1:8093/pptx`
- `http://127.0.0.1:8093/pdf-readonly`

Expose the public development endpoint at `https://docs.okai.com.br`:

```powershell
.\Start-OkaiDocsEditorPublic.ps1 -NoBuild
```

See `DEPLOYMENT.md` for configuration, validation, Cloudflare Tunnel details, and
host-platform integration notes.

## Public Source And Internal Operation

This repository is intended to be public source for the modified Okai Docs editor
runtime while still being usable by the internal deployment. Keep real secrets,
Cloudflare credentials, machine-specific Compose overrides, logs, generated
packages, and runtime document files outside Git.

## Licensing

This repository keeps the runtime overlay aligned with the Euro-Office AGPLv3
base. The image build context copies only the runtime files needed by the current
deployment; unrelated legacy source trees are not part of this public runtime
source tree.
