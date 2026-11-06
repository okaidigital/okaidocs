const WORD_TYPES = new Set(["doc", "docx", "dot", "dotx", "odt", "ott", "rtf", "txt"]);

// O endpoint recebe somente a identidade da sessão. Nunca assina uma URL do cliente.
function buildComparisonCommand(session, internalBaseUrl, sign) {
  if (session.kind !== "word" || !WORD_TYPES.has(session.fileType) || session.closedAt) {
    throw new Error("The broker session is not available for document comparison.");
  }
  if (!/^[a-f0-9-]{36}$/i.test(session.id) || !session.secret || !session.filename) {
    throw new Error("Invalid broker comparison session.");
  }
  const base = new URL(internalBaseUrl);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid editor file origin.");
  const file = new URL(`/broker/files/${session.id}/${encodeURIComponent(session.filename)}`, base);
  file.searchParams.set("token", session.secret);
  const payload = { c: "compare", fileType: session.fileType, url: file.toString() };
  return { ...payload, token: sign(payload) };
}

module.exports = { buildComparisonCommand };
