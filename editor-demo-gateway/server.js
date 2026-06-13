const http = require("http");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const FILES_DIR = path.join(ROOT, "files");
const DEV_SESSIONS_DIR = path.join(FILES_DIR, "dev-sessions");
const BLANK_FILES_DIR = path.join(ROOT, "blank-files");
const EDITOR_HOST_INTERNAL_URL =
  process.env.OKD_EDITOR_HOST_INTERNAL_URL || "http://editor-demo-gateway:3000";
const EDITOR_INTERNAL_URL = process.env.OKD_EDITOR_INTERNAL_URL || "http://editor";
const PUBLIC_EDITOR_URL = process.env.OKD_PUBLIC_EDITOR_URL || "";
const JWT_SECRET = process.env.OKD_JWT_SECRET || "";
const JWT_TTL_SECONDS = Number(process.env.OKD_JWT_TTL_SECONDS || 3600);
const DEMO_ACCESS_TOKEN = process.env.OKD_DEMO_ACCESS_TOKEN || "";
const DEMO_ACCESS_PARAM = process.env.OKD_DEMO_ACCESS_PARAM || "okd_access";
const SESSION_PARAM = process.env.OKD_SESSION_PARAM || "okd_session";
const DEMO_ACCESS_COOKIE = process.env.OKD_DEMO_ACCESS_COOKIE || "okd_demo_access";
const DEMO_ACCESS_MAX_AGE_SECONDS = Number(
  process.env.OKD_DEMO_ACCESS_MAX_AGE_SECONDS || 8 * 60 * 60,
);
const MAX_UPLOAD_BYTES = Number(process.env.OKD_MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const DEFAULT_FRAME_ANCESTORS =
  "'self' http://localhost:* https://localhost:* https://okai.com.br https://app.okai.com.br https://www.okai.com.br https://okaiedgeqa.azurewebsites.net https://okaiedge.azurewebsites.net";
const FRAME_ANCESTORS = normalizeFrameAncestors(
  process.env.OKD_FRAME_ANCESTORS || DEFAULT_FRAME_ANCESTORS,
);
const MIN_PUBLIC_ACCESS_TOKEN_LENGTH = 32;

const earlyEditorCss = `
  <style id="okai-early-editor-look">
    :root {
      --sk-background-toolbar-header-word: #f3f3f3 !important;
      --sk-background-toolbar-header-pdf: #f3f3f3 !important;
      --sk-background-toolbar-header-slide: #f3f3f3 !important;
      --sk-background-toolbar-header-cell: #f3f3f3 !important;
      --sk-background-toolbar: #fbfbfb !important;
      --sk-background-toolbar-controls: #fbfbfb !important;
      --sk-canvas-background: #f3f3f3 !important;
    }

    .loadmask {
      background: #f3f3f3 !important;
    }

    .loadmask > .brendpanel {
      display: none !important;
    }

    .loadmask > .sktoolbar {
      background: #fbfbfb !important;
    }

    .loadmask > .sktoolbar > .box-controls {
      height: 80px !important;
    }

    #app-title,
    #box-document-title {
      display: none !important;
      height: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
  </style>
`;

const lockedDocumentEditorUi = {
  about: false,
  autosave: true,
  chat: false,
  comments: false,
  compactToolbar: false,
  features: {
    featuresTips: false,
    roles: false,
    spellcheck: {
      mode: true,
      change: false,
    },
    tabBackground: {
      mode: "toolbar",
      change: false,
    },
    tabStyle: {
      mode: "line",
      change: false,
    },
  },
  feedback: {
    visible: false,
  },
  forcesave: false,
  help: false,
  hideRulers: true,
  layout: {
    header: {
      editMode: false,
      save: false,
      user: false,
      users: false,
    },
    leftMenu: {
      mode: false,
      navigation: true,
      spellcheck: false,
    },
    rightMenu: {
      mode: false,
    },
    statusBar: {
      actionStatus: false,
      docLang: false,
      textLang: false,
    },
    toolbar: {
      collaboration: true,
      draw: true,
      file: false,
      home: {},
      layout: true,
      plugins: false,
      protect: false,
      references: true,
      save: false,
      view: {
        navigation: true,
        theme: false,
      },
    },
  },
  logo: {
    visible: false,
  },
  macros: false,
  macrosMode: "disable",
  mentionShare: false,
  plugins: false,
  suggestFeature: false,
  unit: "cm",
};

const baseDocumentPermissions = {
  chat: false,
  comment: true,
  copy: true,
  download: false,
  edit: true,
  fillForms: true,
  modifyContentControl: true,
  print: false,
  protect: false,
  review: true,
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeJson(base, overrides) {
  const result = cloneJson(base);

  for (const [key, value] of Object.entries(overrides || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeJson(result[key], value);
    } else {
      result[key] = cloneJson(value);
    }
  }

  return result;
}

function editorUi(overrides) {
  return mergeJson(lockedDocumentEditorUi, overrides);
}

const documents = {
  word: {
    filename: "blank.docx",
    title: "Documento em branco.docx",
    fileType: "docx",
    documentType: "word",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  cell: {
    filename: "blank.xlsx",
    title: "Planilha em branco.xlsx",
    fileType: "xlsx",
    documentType: "cell",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  slide: {
    filename: "blank.pptx",
    title: "Apresentação em branco.pptx",
    fileType: "pptx",
    documentType: "slide",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    customization: editorUi({
      autostart: "document",
    }),
  },
  "pdf-edit": {
    filename: "blank-edit.pdf",
    title: "PDF em branco - editar.pdf",
    fileType: "pdf",
    documentType: "pdf",
    contentType: "application/pdf",
    customization: editorUi({
      comments: true,
      pdfStartMode: "edit",
    }),
  },
  "pdf-comment": {
    filename: "blank-comment.pdf",
    title: "PDF em branco - comentar.pdf",
    fileType: "pdf",
    documentType: "pdf",
    contentType: "application/pdf",
    permissions: {
      edit: false,
      review: false,
      comment: true,
      fillForms: true,
      protect: false,
    },
    customization: editorUi({
      comments: true,
      pdfStartMode: "comment",
    }),
  },
  "pdf-readonly": {
    filename: "blank.pdf",
    title: "PDF em branco.pdf",
    fileType: "pdf",
    documentType: "pdf",
    contentType: "application/pdf",
    editorMode: "view",
    permissions: {
      edit: false,
      review: false,
      comment: false,
      fillForms: false,
      protect: false,
    },
    customization: editorUi({
      comments: false,
    }),
  },
};

const documentAliases = {
  excel: "cell",
  pdf: "pdf-edit",
  ppt: "slide",
  pptx: "slide",
  slides: "slide",
  presentation: "slide",
  presentationeditor: "slide",
  powerpoint: "slide",
};

const brokerKinds = new Set(["word", "cell", "slide"]);

const directEditorRoutes = new Set([
  "/word",
  "/excel",
  "/cell",
  "/ppt",
  "/pptx",
  "/slides",
  "/presentation",
  "/presentationeditor",
  "/powerpoint",
  "/slide",
  "/pdf-edit",
  "/pdf-comment",
  "/pdf-readonly",
]);

const commandRoutes = new Set([
  "/command",
  "/coauthoring/CommandService.ashx",
]);

const brokerOperationQueues = new Map();

function normalizeFrameAncestors(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function headerValueToString(value) {
  return Array.isArray(value) ? value.join("; ") : String(value || "");
}

function takeHeader(headers, name) {
  const lowerName = name.toLowerCase();
  let value = "";

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    if (!value) value = headerValueToString(headers[key]);
    delete headers[key];
  }

  return value;
}

function cspWithFrameAncestors(existingCsp) {
  const directives = headerValueToString(existingCsp)
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => !/^frame-ancestors\b/i.test(directive));

  directives.push(`frame-ancestors ${FRAME_ANCESTORS}`);
  return directives.join("; ");
}

function editorFrameHeaders(headers = {}) {
  const next = { ...headers };
  const existingCsp = takeHeader(next, "Content-Security-Policy");
  takeHeader(next, "X-Frame-Options");
  next["Content-Security-Policy"] = cspWithFrameAncestors(existingCsp);
  return next;
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJsonHead(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end();
}

function sendText(res, status, value, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(value),
    "Cache-Control": "no-store",
  });
  res.end(value);
}

function sendEditorHtml(req, res, status, html) {
  res.writeHead(
    status,
    editorFrameHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
      "Cache-Control": "no-store",
    }),
  );

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(html);
}

function sendUnauthorized(req, res) {
  console.warn("Okai Docs unauthorized", {
    method: req.method,
    path: req.url?.split("?")[0],
    host: req.headers.host,
    referer: req.headers.referer,
    hasCookie: Boolean(req.headers.cookie),
  });
  sendText(
    res,
    401,
    `Unauthorized. Open this editor with a valid ${DEMO_ACCESS_PARAM} query parameter first.`,
  );
}

function sendApiUnauthorized(res) {
  sendJson(res, 401, { error: "Unauthorized" });
}

function cookieValue(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("=") || "");
  }
  return "";
}

function safeEqualText(left, right) {
  const leftHash = crypto.createHash("sha256").update(left || "").digest();
  const rightHash = crypto.createHash("sha256").update(right || "").digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function isInternalRequest(req) {
  const host = String(req.headers.host || "").toLowerCase();
  const internalHost = new URL(EDITOR_HOST_INTERNAL_URL).host.toLowerCase();
  return host === internalHost;
}

function isLoopbackRequest(req) {
  const host = String(req.headers.host || "").toLowerCase().split(":")[0];
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}

function forwardedProto(req) {
  return String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
}

function publicEditorUrl(req) {
  if (PUBLIC_EDITOR_URL) return PUBLIC_EDITOR_URL.replace(/\/+$/, "");
  return `${forwardedProto(req)}://${req.headers.host}`;
}

function publicEditorHost() {
  if (!PUBLIC_EDITOR_URL) return "";
  try {
    return new URL(PUBLIC_EDITOR_URL).host.toLowerCase();
  } catch {
    return "";
  }
}

function configuredUrlHost(rawUrl) {
  if (!rawUrl) return "";
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return "";
  }
}

function shouldUseSecureCookie(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return forwardedProto(req) === "https" || !/^localhost(?::|$)|^127\.0\.0\.1(?::|$)/.test(host);
}

function demoAccessCookieValue() {
  return crypto.createHmac("sha256", DEMO_ACCESS_TOKEN).update("okai-docs-demo-access").digest("base64url");
}

function accessCookie(req) {
  const secureCookie = shouldUseSecureCookie(req);
  const parts = [
    `${DEMO_ACCESS_COOKIE}=${encodeURIComponent(demoAccessCookieValue())}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${secureCookie ? "None" : "Lax"}`,
    `Max-Age=${DEMO_ACCESS_MAX_AGE_SECONDS}`,
  ];
  if (secureCookie) parts.push("Secure");
  return parts.join("; ");
}

function hasValidDemoAccessToken(url) {
  if (!DEMO_ACCESS_TOKEN) return false;
  const token = url.searchParams.get(DEMO_ACCESS_PARAM) || "";
  return Boolean(token) && safeEqualText(token, DEMO_ACCESS_TOKEN);
}

function consumeAccessToken(req, res, url) {
  if (!DEMO_ACCESS_TOKEN) return false;

  const token = url.searchParams.get(DEMO_ACCESS_PARAM) || "";
  if (!token) return false;
  if (!safeEqualText(token, DEMO_ACCESS_TOKEN)) return false;

  url.searchParams.delete(DEMO_ACCESS_PARAM);
  const location = `${url.pathname}${url.search}${url.hash || ""}` || "/";
  res.writeHead(302, {
    Location: location || "/",
    "Set-Cookie": accessCookie(req),
    "Cache-Control": "no-store",
  });
  res.end();
  return true;
}

function isEditorRuntimeRequest(req, url) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  return /^\/(?:(?:\d[\w.-]*)\/)?(?:web-apps|sdkjs|fonts|dictionaries|spellchecker|cache|doc|coauthoring)\//i.test(url.pathname);
}

function hasDemoAccess(req, url) {
  if (!DEMO_ACCESS_TOKEN) return true;
  if (url.pathname === "/health") return true;
  if (isInternalRequest(req)) return true;
  if (isLoopbackRequest(req)) return true;
  if (hasValidDemoAccessToken(url)) return true;
  if (isEditorRuntimeRequest(req, url)) return true;
  return safeEqualText(cookieValue(req, DEMO_ACCESS_COOKIE), demoAccessCookieValue());
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function apiAccessToken(req, url) {
  return (
    bearerToken(req) ||
    String(req.headers["x-okai-docs-access-token"] || "") ||
    url.searchParams.get(DEMO_ACCESS_PARAM) ||
    ""
  );
}

function hasApiAccess(req, url) {
  if (!DEMO_ACCESS_TOKEN) return true;
  if (isInternalRequest(req)) return true;
  if (isLoopbackRequest(req)) return true;

  const token = apiAccessToken(req, url);
  if (token && safeEqualText(token, DEMO_ACCESS_TOKEN)) return true;
  return safeEqualText(cookieValue(req, DEMO_ACCESS_COOKIE), demoAccessCookieValue());
}

async function ensureLocalDocument(doc) {
  const target = path.join(FILES_DIR, doc.filename);

  try {
    const stat = await fs.stat(target);
    if (stat.size > 0) return;
  } catch {
    // Fall through and restore the bundled blank file below.
  }

  const blankFile = path.join(BLANK_FILES_DIR, doc.filename);
  const blankStat = await fs.stat(blankFile).catch(() => null);
  if (!blankStat?.size) {
    throw new Error(`Missing bundled blank file: ${doc.filename}`);
  }

  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.copyFile(blankFile, target);
}

function keyFor(filename, stat) {
  const cleanName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const modified = Math.floor(stat.mtimeMs).toString(36);
  return `${cleanName}-${stat.size}-${modified}`.slice(0, 128);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function base64urlJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signJwt(payload) {
  if (!JWT_SECRET) {
    throw new Error("OKD_JWT_SECRET is required");
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(tokenPayload));
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function verifyJwt(token, purpose) {
  if (!JWT_SECRET) {
    throw new Error("OKD_JWT_SECRET is required");
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid ${purpose || "JWT"} format`);
  }

  const [headerPart, bodyPart, signaturePart] = parts;
  const header = base64urlJson(headerPart);
  if (header.alg !== "HS256") {
    throw new Error(`Unsupported ${purpose || "JWT"} algorithm`);
  }

  const expected = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${headerPart}.${bodyPart}`)
    .digest("base64url");

  if (!safeEqualText(signaturePart, expected)) {
    throw new Error(`Invalid ${purpose || "JWT"} signature`);
  }

  const payload = base64urlJson(bodyPart);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > Number(payload.exp)) {
    throw new Error(`Expired ${purpose || "JWT"}`);
  }
  if (payload.nbf && now + 5 < Number(payload.nbf)) {
    throw new Error(`${purpose || "JWT"} is not active yet`);
  }

  return payload;
}

function cleanDocumentKey(value) {
  const key = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._=-]/g, "_")
    .slice(0, 128);
  return key || crypto.randomBytes(16).toString("hex");
}

function hasBrokerContent(input) {
  return Boolean(
    input.contentBase64 ||
      input.fileBase64 ||
      input.dataBase64 ||
      input.base64,
  );
}

function brokerSourceDocumentId(input) {
  const source = input.documentId || input.sourceDocumentId || "";
  return String(source).trim() || null;
}

function brokerUserFromInput(input) {
  return mergeJson(
    {
      id: input.userId || "okai-dev-user",
      name: input.userName || "Okai Docs",
    },
    input.user || {},
  );
}

function brokerLockKey(kind, sourceDocumentId) {
  return sourceDocumentId ? `document:${kind}:${sourceDocumentId}` : "";
}

async function withBrokerQueue(key, operation) {
  const queueKey = key || `operation:${crypto.randomUUID()}`;
  const previous = brokerOperationQueues.get(queueKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  brokerOperationQueues.set(queueKey, current);

  try {
    return await current;
  } finally {
    if (brokerOperationQueues.get(queueKey) === current) {
      brokerOperationQueues.delete(queueKey);
    }
  }
}

function brokerLog(event, fields = {}) {
  console.log(
    "Okai Docs broker",
    JSON.stringify({
      event,
      ...fields,
    }),
  );
}

function normalizeKind(value) {
  const kind = String(value || "word").trim().toLowerCase();
  if (kind === "docx" || kind === "document") return "word";
  if (kind === "xlsx" || kind === "spreadsheet") return "cell";
  if (
    kind === "pptx" ||
    kind === "slides" ||
    kind === "presentation" ||
    kind === "presentationeditor" ||
    kind === "powerpoint"
  ) return "slide";
  return documentAliases[kind] || kind;
}

function routeForKind(kind) {
  if (kind === "cell") return "excel";
  if (kind === "slide") return "pptx";
  return kind;
}

function assertBrokerSessionId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid broker session id.");
  }
}

function brokerSessionDir(id) {
  assertBrokerSessionId(id);
  return path.join(DEV_SESSIONS_DIR, id);
}

function brokerSessionMetaPath(id) {
  return path.join(brokerSessionDir(id), "session.json");
}

function brokerSessionFilePath(session) {
  return path.join(brokerSessionDir(session.id), session.filename);
}

async function writeFileAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, targetPath);
}

function sanitizeFilename(title, fileType) {
  const extension = `.${fileType}`;
  const raw = String(title || `Documento.${fileType}`)
    .split(/[\\/]/)
    .pop()
    .trim();
  const withoutExtension = raw.toLowerCase().endsWith(extension)
    ? raw.slice(0, -extension.length)
    : raw;
  const safeBase = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96) || "Documento";
  return `${safeBase}${extension}`;
}

function decodeBrokerContent(input) {
  const encoded =
    input.contentBase64 ||
    input.fileBase64 ||
    input.dataBase64 ||
    input.base64 ||
    "";
  if (!encoded) return null;

  const clean = String(encoded).replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  const data = Buffer.from(clean, "base64");
  if (!data.length) {
    throw new Error("Broker session content is empty.");
  }
  return data;
}

async function brokerInitialFile(input, doc) {
  const uploaded = decodeBrokerContent(input);
  if (uploaded) return uploaded;

  const priorSession = input.priorSession || null;
  if (priorSession) {
    return fs.readFile(brokerSessionFilePath(priorSession));
  }

  const blankFile = path.join(BLANK_FILES_DIR, doc.filename);
  return fs.readFile(blankFile).catch(() => fs.readFile(path.join(FILES_DIR, doc.filename)));
}

async function loadBrokerSession(id) {
  const text = await fs.readFile(brokerSessionMetaPath(id), "utf8");
  return JSON.parse(text);
}

async function saveBrokerSession(session) {
  const dir = brokerSessionDir(session.id);
  await fs.mkdir(dir, { recursive: true });
  await writeFileAtomic(brokerSessionMetaPath(session.id), JSON.stringify(session, null, 2));
}

async function listBrokerSessions() {
  let entries = [];
  try {
    entries = await fs.readdir(DEV_SESSIONS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      sessions.push(await loadBrokerSession(entry.name));
    } catch (error) {
      brokerLog("session-scan-error", {
        sessionId: entry.name,
        error: error.message,
      });
    }
  }

  return sessions;
}

function brokerSessionTimestamp(session) {
  return Date.parse(session.updatedAt || session.createdAt || 0) || 0;
}

function newestBrokerSession(sessions) {
  return [...sessions].sort((left, right) => brokerSessionTimestamp(right) - brokerSessionTimestamp(left))[0] || null;
}

async function findBrokerSessionsBySource(kind, sourceDocumentId) {
  if (!sourceDocumentId) return { active: null, prior: null, duplicates: [] };

  const matches = (await listBrokerSessions()).filter(
    (session) => session.kind === kind && session.sourceDocumentId === sourceDocumentId,
  );
  const activeMatches = matches.filter((session) => !session.closedAt);
  const closedMatches = matches.filter((session) => session.closedAt);
  const active = newestBrokerSession(activeMatches);
  const prior = newestBrokerSession(closedMatches) || newestBrokerSession(matches);

  return {
    active,
    prior,
    duplicates: active ? activeMatches.filter((session) => session.id !== active.id) : [],
  };
}

function brokerSessionToResponse(req, session, launchUser = session.user) {
  const editorUrl = new URL(`/${session.route}`, publicEditorUrl(req));
  if (DEMO_ACCESS_TOKEN) {
    editorUrl.searchParams.set(DEMO_ACCESS_PARAM, DEMO_ACCESS_TOKEN);
  }
  editorUrl.searchParams.set(SESSION_PARAM, brokerSessionLaunchToken(session, launchUser));

  return {
    id: session.id,
    sourceDocumentId: session.sourceDocumentId || null,
    kind: session.kind,
    route: session.route,
    title: session.title,
    fileType: session.fileType,
    documentType: session.documentType,
    key: session.key,
    version: session.version,
    currentVersion: session.version,
    lastCallbackStatus: session.lastCallbackStatus || null,
    lastCallbackAt: session.lastCallbackAt || null,
    lastCallbackError: session.lastCallbackError || null,
    lastSavedAt: session.lastSavedAt || null,
    savedAt: session.lastSavedAt || null,
    closedAt: session.closedAt || null,
    lastForceSaveRequestedAt: session.lastForceSaveRequestedAt || null,
    lastForceSaveCompletedAt: session.lastForceSaveCompletedAt || null,
    lastForceSaveStatus: session.lastForceSaveStatus || null,
    lastForceSaveError: session.lastForceSaveError || null,
    editorUrl: editorUrl.toString(),
    statusUrl: `${publicEditorUrl(req)}/api/dev-sessions/${session.id}`,
    fileUrl: `${publicEditorUrl(req)}/api/dev-sessions/${session.id}/file`,
  };
}

function brokerSessionLaunchToken(session, launchUser = session.user) {
  const fileUrl = new URL(
    `/broker/files/${session.id}/${encodeURIComponent(session.filename)}`,
    EDITOR_HOST_INTERNAL_URL,
  );
  fileUrl.searchParams.set("token", session.secret);

  const callbackUrl = new URL(`/broker/callback/${session.id}`, EDITOR_HOST_INTERNAL_URL);
  callbackUrl.searchParams.set("token", session.secret);

  return signJwt({
    documentId: session.sourceDocumentId || session.id,
    brokerSessionId: session.id,
    sourceDocumentId: session.sourceDocumentId || null,
    fileUrl: fileUrl.toString(),
    callbackUrl: callbackUrl.toString(),
    key: session.key,
    title: session.title,
    fileType: session.fileType,
    documentType: session.documentType,
    user: launchUser,
    permissions: session.permissions || {},
  });
}

function mergeBrokerParticipant(session, user, now) {
  const userId = String(user.id || "okai-dev-user");
  return {
    ...session,
    user,
    participants: {
      ...(session.participants || {}),
      [userId]: {
        id: userId,
        name: user.name || userId,
        lastSeenAt: now,
      },
    },
    updatedAt: now,
  };
}

async function createBrokerSession(input, options = {}) {
  const kind = normalizeKind(input.kind || input.documentType || input.fileType);
  if (!brokerKinds.has(kind)) {
    throw new Error("Broker sessions support word/docx, excel/xlsx, and presentation/pptx documents.");
  }

  const doc = documents[kind];
  const fileType = String(input.fileType || doc.fileType).trim().toLowerCase();
  if (fileType !== doc.fileType) {
    throw new Error(`Expected fileType ${doc.fileType} for ${kind}.`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = String(input.title || doc.title).trim() || doc.title;
  const filename = sanitizeFilename(title, fileType);
  const initialFile = await brokerInitialFile({ ...input, priorSession: options.priorSession || null }, doc);
  const sourceDocumentId = brokerSourceDocumentId(input);
  const user = brokerUserFromInput(input);
  const session = {
    id,
    sourceDocumentId,
    kind,
    route: routeForKind(kind),
    title: filename,
    filename,
    fileType,
    documentType: doc.documentType,
    contentType: doc.contentType,
    key: cleanDocumentKey(input.key || `${id}-active`),
    secret: crypto.randomBytes(32).toString("base64url"),
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastSavedAt: null,
    lastCallbackStatus: null,
    lastCallbackError: null,
    user,
    participants: {
      [String(user.id || "okai-dev-user")]: {
        id: String(user.id || "okai-dev-user"),
        name: user.name || String(user.id || "okai-dev-user"),
        lastSeenAt: now,
      },
    },
    permissions: input.permissions || {},
  };

  const dir = brokerSessionDir(id);
  await fs.mkdir(dir, { recursive: true });
  await writeFileAtomic(brokerSessionFilePath(session), initialFile);
  await saveBrokerSession(session);
  brokerLog("session-created", {
    documentId: sourceDocumentId,
    sessionId: session.id,
    key: session.key,
    kind,
    userId: user.id,
    fromPriorSessionId: options.priorSession?.id || null,
  });
  return session;
}

async function createOrReuseBrokerSession(input) {
  const kind = normalizeKind(input.kind || input.documentType || input.fileType);
  const sourceDocumentId = brokerSourceDocumentId(input);
  const lockKey = brokerLockKey(kind, sourceDocumentId);
  const user = brokerUserFromInput(input);

  return withBrokerQueue(lockKey, async () => {
    const existing = await findBrokerSessionsBySource(kind, sourceDocumentId);
    if (existing.duplicates.length) {
      brokerLog("session-active-duplicates", {
        documentId: sourceDocumentId,
        kind,
        selectedSessionId: existing.active?.id || null,
        duplicateSessionIds: existing.duplicates.map((session) => session.id),
      });
    }

    if (existing.active) {
      const now = new Date().toISOString();
      const nextSession = mergeBrokerParticipant(existing.active, user, now);
      await saveBrokerSession(nextSession);
      brokerLog("session-reused", {
        documentId: sourceDocumentId,
        sessionId: nextSession.id,
        key: nextSession.key,
        kind,
        userId: user.id,
        ignoredContentBase64: hasBrokerContent(input),
      });
      return { session: nextSession, user, created: false };
    }

    const session = await createBrokerSession(input, { priorSession: existing.prior });
    return { session, user, created: true };
  });
}

function requireBrokerToken(session, url) {
  const token = url.searchParams.get("token") || "";
  if (!safeEqualText(token, session.secret)) {
    throw new Error("Invalid broker session token.");
  }
}

async function serveBrokerFile(req, res, id, url) {
  const session = await loadBrokerSession(id);
  requireBrokerToken(session, url);
  const filePath = brokerSessionFilePath(session);
  const stat = await fs.stat(filePath);

  res.writeHead(200, {
    "Content-Type": session.contentType,
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(await fs.readFile(filePath));
}

async function saveBrokerCallbackFile(session, payload) {
  const now = new Date().toISOString();
  const callbackFields = {
    ...session,
    updatedAt: now,
    lastCallbackAt: now,
    lastCallbackStatus: payload.status ?? null,
    lastCallbackError: null,
  };

  if (payload.status === 7) {
    return {
      ...callbackFields,
      lastCallbackError: payload.error || payload.message || "DocumentServer save error",
    };
  }

  if (![2, 6].includes(payload.status) || !payload.url) return callbackFields;

  const response = await fetch(callbackDownloadUrl(payload.url));
  if (!response.ok) {
    throw new Error(`Could not fetch broker edited file: ${response.status}`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  await writeFileAtomic(brokerSessionFilePath(session), data);
  const savedAt = new Date().toISOString();
  const nextVersion = Number(session.version || 1) + 1;

  return {
    ...callbackFields,
    version: nextVersion,
    updatedAt: savedAt,
    lastSavedAt: savedAt,
    lastSavedStatus: payload.status,
    closedAt: payload.status === 2 ? savedAt : session.closedAt || null,
  };
}

async function handleBrokerCallback(req, res, id, url) {
  const payload = await readRequestBody(req);
  await withBrokerQueue(`session:${id}`, async () => {
    const session = await loadBrokerSession(id);
    requireBrokerToken(session, url);
    brokerLog("callback-received", {
      documentId: session.sourceDocumentId || null,
      sessionId: id,
      key: session.key,
      status: payload.status ?? null,
    });
    const nextSession = await saveBrokerCallbackFile(session, payload);
    await saveBrokerSession(nextSession);
    brokerLog("callback-stored", {
      documentId: nextSession.sourceDocumentId || null,
      sessionId: id,
      key: nextSession.key,
      status: payload.status ?? null,
      version: nextSession.version,
      lastSavedAt: nextSession.lastSavedAt || null,
      closedAt: nextSession.closedAt || null,
      error: nextSession.lastCallbackError || null,
    });
  });
  sendJson(res, 200, { error: 0 });
}

async function forceSaveBrokerSession(session) {
  const requestedAt = new Date().toISOString();
  const command = {
    c: "forcesave",
    key: session.key,
  };
  const body = {
    ...command,
    token: signJwt(command),
  };
  const target = new URL("/command", EDITOR_INTERNAL_URL);
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep the raw response for diagnostics.
  }
  const onlyOfficeError =
    payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "error")
      ? Number(payload.error)
      : null;
  const ok = response.ok && (onlyOfficeError === null || onlyOfficeError === 0);
  const completedAt = new Date().toISOString();
  const result = {
    ok,
    status: response.status,
    result: payload,
    requestedAt,
    completedAt,
  };
  const nextSession = {
    ...session,
    updatedAt: completedAt,
    lastForceSaveRequestedAt: requestedAt,
    lastForceSaveCompletedAt: completedAt,
    lastForceSaveStatus: response.status,
    lastForceSaveResult: payload,
    lastForceSaveError: ok ? null : payload,
  };
  await saveBrokerSession(nextSession);
  brokerLog("forcesave-completed", {
    documentId: session.sourceDocumentId || null,
    sessionId: session.id,
    key: session.key,
    ok,
    status: response.status,
    onlyOfficeError,
  });
  return result;
}

function brokerApiSessionId(pathname, suffix = "") {
  const prefix = "/api/dev-sessions/";
  if (!pathname.startsWith(prefix)) return "";
  const rest = pathname.slice(prefix.length);
  if (suffix && !rest.endsWith(suffix)) return "";
  const id = suffix ? rest.slice(0, -suffix.length) : rest;
  return id.replace(/\/+$/, "");
}

async function handleBrokerApi(req, res, url) {
  if (!hasApiAccess(req, url)) {
    sendApiUnauthorized(res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/dev-sessions") {
    const input = await readRequestBody(req, MAX_UPLOAD_BYTES);
    const result = await createOrReuseBrokerSession(input);
    sendJson(res, result.created ? 201 : 200, brokerSessionToResponse(req, result.session, result.user));
    return true;
  }

  if (req.method === "POST") {
    const id = brokerApiSessionId(url.pathname, "/forcesave");
    if (id) {
      const result = await withBrokerQueue(`session:${id}`, async () => {
        const session = await loadBrokerSession(id);
        brokerLog("forcesave-requested", {
          documentId: session.sourceDocumentId || null,
          sessionId: session.id,
          key: session.key,
        });
        return forceSaveBrokerSession(session);
      });
      sendJson(res, result.ok ? 200 : 502, result);
      return true;
    }
  }

  if (req.method === "GET") {
    const id = brokerApiSessionId(url.pathname, "/file");
    if (id) {
      const session = await loadBrokerSession(id);
      const filePath = brokerSessionFilePath(session);
      const stat = await fs.stat(filePath);
      res.writeHead(200, {
        "Content-Type": session.contentType,
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${session.filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      });
      res.end(await fs.readFile(filePath));
      return true;
    }
  }

  if (req.method === "GET") {
    const id = brokerApiSessionId(url.pathname);
    if (id) {
      const session = await loadBrokerSession(id);
      sendJson(res, 200, brokerSessionToResponse(req, session));
      return true;
    }
  }

  if (req.method === "DELETE") {
    const id = brokerApiSessionId(url.pathname);
    if (id) {
      await fs.rm(brokerSessionDir(id), { recursive: true, force: true });
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

function buildSessionConfig(kind, session) {
  const baseDoc = documents[kind] || documents[documentAliases[kind]];
  if (!baseDoc) return null;

  const sessionConfig =
    session.config && typeof session.config === "object" && !Array.isArray(session.config)
      ? session.config
      : {};
  const sessionDocument = mergeJson(sessionConfig.document || {}, session.document || {});
  const sessionEditorConfig = mergeJson(
    sessionConfig.editorConfig || {},
    session.editorConfig || {},
  );
  const documentId = session.documentId || session.id || sessionDocument.id || sessionDocument.key;
  const fileUrl =
    session.fileUrl ||
    session.documentUrl ||
    session.url ||
    sessionDocument.url;
  const callbackUrl = session.callbackUrl || sessionEditorConfig.callbackUrl;

  if (!fileUrl) {
    throw new Error(`Signed ${SESSION_PARAM} must include fileUrl.`);
  }
  if (!callbackUrl) {
    throw new Error(`Signed ${SESSION_PARAM} must include callbackUrl.`);
  }

  const documentType = session.documentType || sessionConfig.documentType || baseDoc.documentType;
  const fileType = session.fileType || sessionDocument.fileType || baseDoc.fileType;
  const title = session.title || sessionDocument.title || baseDoc.title;
  const key = cleanDocumentKey(
    session.key ||
      sessionDocument.key ||
      [documentId || kind, session.version || session.updatedAt || "v1"].join("-"),
  );
  const user = mergeJson(
    {
      id: session.userId || "okai-platform-user",
      name: session.userName || "Okai Docs",
    },
    session.user || sessionEditorConfig.user || {},
  );

  const config = mergeJson(
    {
      documentType,
      width: "100%",
      height: "100%",
      document: {
        fileType,
        key,
        title,
        url: fileUrl,
        permissions: {
          ...baseDocumentPermissions,
          ...(session.permissions || {}),
          ...(sessionDocument.permissions || {}),
        },
      },
      editorConfig: {
        callbackUrl,
        coEditing: {
          mode: "fast",
          change: false,
        },
        lang: session.lang || "pt",
        mode: "edit",
        recent: [],
        region: session.region || "pt-BR",
        templates: [],
        user,
        customization: editorUi({
          forcesave: true,
          layout: {
            header: {
              save: true,
            },
            toolbar: {
              save: true,
            },
          },
        }),
        plugins: {
          autostart: [],
          pluginsData: [],
        },
      },
    },
    sessionConfig,
  );

  config.document.url = fileUrl;
  config.document.key = key;
  config.document.fileType = fileType;
  config.document.title = title;
  config.editorConfig.callbackUrl = callbackUrl;
  config.editorConfig.mode = "edit";
  config.editorConfig.coEditing = {
    ...(config.editorConfig.coEditing || {}),
    mode: "fast",
    change: false,
  };
  config.editorConfig.user = user;
  config.token = signJwt(config);
  return config;
}

function sessionFromUrl(url) {
  const token = url.searchParams.get(SESSION_PARAM) || url.searchParams.get("okd_config");
  if (!token) return null;
  return verifyJwt(token, SESSION_PARAM);
}

async function buildConfig(kind, url) {
  kind = normalizeKind(kind);
  const session = sessionFromUrl(url);
  if (session) {
    return buildSessionConfig(kind, session);
  }

  const doc = documents[kind] || documents[documentAliases[kind]];
  if (!doc) return null;

  await ensureLocalDocument(doc);
  const filePath = path.join(FILES_DIR, doc.filename);
  const stat = await fs.stat(filePath);
  const fileUrl = `${EDITOR_HOST_INTERNAL_URL}/files/${encodeURIComponent(doc.filename)}`;

  const config = {
    documentType: doc.documentType,
    width: "100%",
    height: "100%",
    document: {
      fileType: doc.fileType,
      key: keyFor(doc.filename, stat),
      title: doc.title,
      url: fileUrl,
      permissions: {
        ...baseDocumentPermissions,
        ...(doc.permissions || {}),
      },
    },
    editorConfig: {
      callbackUrl: `${EDITOR_HOST_INTERNAL_URL}/callback/${encodeURIComponent(doc.filename)}`,
      coEditing: {
        mode: "fast",
        change: false,
      },
      lang: "pt",
      mode: doc.editorMode || "edit",
      recent: [],
      region: "pt-BR",
      templates: [],
      user: {
        id: "local-user",
        name: "Okai Docs",
      },
      customization: doc.customization || lockedDocumentEditorUi,
      plugins: {
        autostart: [],
        pluginsData: [],
      },
    },
  };

  config.token = signJwt(config);
  return config;
}

async function serveFile(req, res, filename) {
  const doc = Object.values(documents).find((item) => item.filename === filename);
  if (!doc) {
    sendText(res, 404, "Not found");
    return;
  }

  await ensureLocalDocument(doc);
  const filePath = path.join(FILES_DIR, doc.filename);
  const stat = await fs.stat(filePath);

  res.writeHead(200, {
    "Content-Type": doc.contentType,
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const data = await fs.readFile(filePath);
  res.end(data);
}

async function readRequestBuffer(req, maxBytes = MAX_UPLOAD_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readRequestBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  const body = (await readRequestBuffer(req, maxBytes)).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function callbackDownloadUrl(rawUrl) {
  const source = new URL(rawUrl);
  if (!["http:", "https:"].includes(source.protocol)) {
    throw new Error(`Refusing callback download with unsupported protocol: ${source.protocol}`);
  }

  const host = source.hostname.toLowerCase();
  const isLoopback = ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host);
  const sourceHost = source.host.toLowerCase();
  const allowedHosts = new Set(
    [publicEditorHost(), configuredUrlHost(EDITOR_HOST_INTERNAL_URL), configuredUrlHost(EDITOR_INTERNAL_URL)]
      .filter(Boolean),
  );

  if (!isLoopback && !allowedHosts.has(sourceHost)) {
    throw new Error(`Refusing callback download from untrusted host: ${sourceHost}`);
  }

  const publicHost = publicEditorHost();
  if (!isLoopback && sourceHost !== publicHost) return source.toString();

  const internalBase = source.pathname.startsWith("/files/") || source.pathname.startsWith("/broker/files/")
    ? EDITOR_HOST_INTERNAL_URL
    : EDITOR_INTERNAL_URL;
  return new URL(`${source.pathname}${source.search}`, internalBase).toString();
}

async function saveFromCallback(filename, payload) {
  if (![2, 6].includes(payload.status) || !payload.url) return;

  const doc = Object.values(documents).find((item) => item.filename === filename);
  if (!doc) throw new Error(`Unknown callback file: ${filename}`);

  const response = await fetch(callbackDownloadUrl(payload.url));
  if (!response.ok) {
    throw new Error(`Could not fetch edited file: ${response.status}`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(path.join(FILES_DIR, doc.filename), data);
}

async function handleCallback(req, res, filename) {
  const payload = await readRequestBody(req);
  console.log("Okai Docs callback", filename, payload.status);
  await saveFromCallback(filename, payload);
  sendJson(res, 200, { error: 0 });
}

function isCommandRoute(req, url) {
  return req.method === "POST" && commandRoutes.has(url.pathname);
}

function hasValidCommandToken(bodyBuffer) {
  try {
    const body = bodyBuffer.toString("utf8");
    const payload = body ? JSON.parse(body) : {};
    if (!payload.token) return false;
    const command = verifyJwt(payload.token, "command JWT");
    if (command.c !== "forcesave") return false;
    return true;
  } catch (error) {
    console.warn("Okai Docs command authorization failed", error.message);
    return false;
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (isCommandRoute(req, url)) {
    const bodyBuffer = await readRequestBuffer(req);
    if (!hasValidCommandToken(bodyBuffer)) {
      sendText(res, 401, "Unauthorized command request.");
      return;
    }

    await proxyEditor(req, res, bodyBuffer);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/broker/files/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    await serveBrokerFile(req, res, parts[2], url);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/broker/callback/")) {
    const id = url.pathname.slice("/broker/callback/".length).replace(/\/+$/, "");
    await handleBrokerCallback(req, res, id, url);
    return;
  }

  if (url.pathname === "/api/dev-sessions" || url.pathname.startsWith("/api/dev-sessions/")) {
    if (await handleBrokerApi(req, res, url)) return;
    sendText(res, 404, "Not found");
    return;
  }

  if (consumeAccessToken(req, res, url)) return;
  if (!hasDemoAccess(req, url)) {
    sendUnauthorized(req, res);
    return;
  }

  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (url.pathname === "/" || directEditorRoutes.has(url.pathname))
  ) {
    const html = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
    sendEditorHtml(req, res, 200, html);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/favicon.ico") {
    res.writeHead(204, {
      "cache-control": "public, max-age=86400",
      "content-length": "0",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/settings") {
    sendJson(res, 200, {
      editorUrl: publicEditorUrl(req),
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/config/")) {
    const kind = decodeURIComponent(url.pathname.slice("/config/".length));
    const config = await buildConfig(kind, url);
    if (!config) {
      sendJson(res, 404, { error: "Tipo de documento desconhecido" });
      return;
    }
    sendJson(res, 200, config);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/files/")) {
    const filename = decodeURIComponent(url.pathname.slice("/files/".length));
    await serveFile(req, res, filename);
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/callback/")) {
    const filename = decodeURIComponent(url.pathname.slice("/callback/".length));
    await handleCallback(req, res, filename);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
    if (req.method === "HEAD") {
      sendJsonHead(res, 200, { ok: true });
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  await proxyEditor(req, res);
}

async function proxyEditor(req, res, bodyBuffer) {
  const target = new URL(req.url, EDITOR_INTERNAL_URL);
  const forwardedHost = req.headers.host || target.host;
  const requestHeaders = {
    ...req.headers,
    "accept-encoding": "identity",
    host: forwardedHost,
    "x-forwarded-host": forwardedHost,
    "x-forwarded-proto": forwardedProto(req),
  };

  if (bodyBuffer) {
    requestHeaders["content-length"] = Buffer.byteLength(bodyBuffer);
  }

  const proxyReq = http.request(
    target,
    {
      method: req.method,
      headers: requestHeaders,
    },
    (proxyRes) => {
      const applyFrameHeaders = shouldApplyFrameHeadersToProxiedHtml(req, target, proxyRes);

      if (shouldInjectEditorHtml(req, target, proxyRes)) {
        let body = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", (chunk) => {
          body += chunk;
        });
        proxyRes.on("end", () => {
          const patchedBody = injectEarlyEditorCss(body);
          const headers = {
            ...proxyRes.headers,
            "content-length": Buffer.byteLength(patchedBody),
          };
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];
          res.writeHead(proxyRes.statusCode || 200, editorFrameHeaders(headers));
          res.end(patchedBody);
        });
        return;
      }

      const headers = applyFrameHeaders ? editorFrameHeaders(proxyRes.headers) : proxyRes.headers;
      res.writeHead(proxyRes.statusCode || 502, headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    console.error("Okai Docs editor proxy error", error.message);
    sendJson(res, 502, { error: error.message });
  });

  if (bodyBuffer) {
    proxyReq.end(bodyBuffer);
  } else {
    req.pipe(proxyReq);
  }
}

function shouldInjectEditorHtml(req, target, proxyRes) {
  if (req.method !== "GET") return false;
  if (!/text\/html/i.test(String(proxyRes.headers["content-type"] || ""))) return false;
  return /\/web-apps\/apps\/(?:documenteditor|spreadsheeteditor|presentationeditor|pdfeditor)\/main\/index\.html/i.test(
    target.pathname,
  );
}

function shouldApplyFrameHeadersToProxiedHtml(req, target, proxyRes) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!/text\/html/i.test(String(proxyRes.headers["content-type"] || ""))) return false;
  return /\/web-apps\/apps\/(?:documenteditor|spreadsheeteditor|presentationeditor|pdfeditor)\//i.test(
    target.pathname,
  );
}

function injectEarlyEditorCss(html) {
  if (html.includes('id="okai-early-editor-look"')) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${earlyEditorCss}\n</head>`);
  }
  return `${earlyEditorCss}\n${html}`;
}

function proxyEditorUpgrade(req, socket, head) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!hasDemoAccess(req, url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 12\r\n\r\nUnauthorized");
    socket.destroy();
    return;
  }

  const target = new URL(req.url, EDITOR_INTERNAL_URL);
  const forwardedHost = req.headers.host || target.host;
  const net = require("net");
  const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries({
          ...req.headers,
          host: forwardedHost,
          "x-forwarded-host": forwardedHost,
          "x-forwarded-proto": forwardedProto(req),
        })
          .map(([name, value]) => `${name}: ${value}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
}

async function notFound(res) {
  sendText(res, 404, "Not found");
}

function routeErrorResponse(error) {
  const message = error?.message || "Internal server error";
  if (message === "Invalid broker session token.") {
    return { status: 401, error: "Unauthorized broker callback." };
  }
  if (message.startsWith("Refusing callback download")) {
    return { status: 400, error: "Untrusted callback download URL." };
  }
  return { status: 500, error: message };
}

function validateSecurityConfiguration() {
  if (!PUBLIC_EDITOR_URL) return;
  if (!DEMO_ACCESS_TOKEN || DEMO_ACCESS_TOKEN.length < MIN_PUBLIC_ACCESS_TOKEN_LENGTH) {
    throw new Error(
      `OKD_DEMO_ACCESS_TOKEN must be at least ${MIN_PUBLIC_ACCESS_TOKEN_LENGTH} characters when OKD_PUBLIC_EDITOR_URL is set.`,
    );
  }
}

validateSecurityConfiguration();

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    const response = routeErrorResponse(error);
    sendJson(res, response.status, { error: response.error });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Okai Docs editor demo gateway listening on ${PORT}`);
});

server.on("upgrade", proxyEditorUpgrade);
