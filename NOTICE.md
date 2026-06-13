# Notices

Okai Docs uses Euro-Office DocumentServer as the upstream editor runtime base:

```text
ghcr.io/euro-office/documentserver:v9.3.1
```

The modified runtime source for Okai's public editor deployment is published in
this repository under AGPLv3. The repository contains Okai-specific integration
and runtime overlay changes for iframe embedding, signed launch sessions,
temporary brokered document sessions, force-save routing, PT-BR locale
overrides, UI restrictions, icon patches, and local deployment automation.

This repository intentionally excludes private runtime state such as real
environment files, Cloudflare credentials, local document sessions, logs,
generated deployment packages, Docker volumes, and machine-specific overrides.

Third-party Node.js dependencies are declared through the committed
`package.json` and `npm-shrinkwrap.json` files in the runtime source tree.
