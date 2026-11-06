// O transporte nativo de download usa o JWT do editor, inclusive sem cookie de demonstração.
function hasSignedEditorDownload(req, url, verify) {
  if (req.method !== "POST" || !/^\/(?:\d[\w.-]*\/)?downloadas\/[^/]+\/?$/i.test(url.pathname)) return false;
  try {
    const command = JSON.parse(url.searchParams.get("cmd") || "null");
    if (!command || !["save", "savefromorigin"].includes(command.c) || typeof command.id !== "string") return false;
    const segments = url.pathname.split("/").filter(Boolean);
    if (decodeURIComponent(segments[segments.length - 1]) !== command.id) return false;
    if (command.tokenDownload) {
      const signed = verify(command.tokenDownload, "editor download");
      return signed.c === "compare" && signed.url === command.url && signed.fileType === command.format;
    }
    if (command.tokenSession) {
      const signed = verify(command.tokenSession, "editor session");
      const doc = signed.document;
      return !!doc && doc.key === command.id && (!doc.permissions || doc.permissions.download !== false || doc.permissions.print !== false);
    }
  } catch { }
  return false;
}
module.exports = { hasSignedEditorDownload };
