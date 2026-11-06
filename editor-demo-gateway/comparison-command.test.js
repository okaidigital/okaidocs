const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { buildComparisonCommand } = require("./comparison-command");
const session = { id: "b7c74b7a-f68c-4e4a-a6c3-c898da4e621f", kind: "word", fileType: "docx",
  filename: "Política revisada.docx", secret: "credencial-efemera-de-teste" };

test("assina exatamente o comando e a URL interna da cópia selecionada", () => {
  const sign = payload => crypto.createHmac("sha256", "chave-intencional-de-teste").update(JSON.stringify(payload)).digest("hex");
  const result = buildComparisonCommand(session, "http://editor-demo-gateway:3000", sign);
  const { token, ...payload } = result;
  assert.equal(token, sign(payload));
  assert.equal(result.c, "compare");
  assert.equal(result.fileType, "docx");
  const url = new URL(result.url);
  assert.equal(url.origin, "http://editor-demo-gateway:3000");
  assert.equal(decodeURIComponent(url.pathname), `/broker/files/${session.id}/${session.filename}`);
  assert.equal(url.searchParams.get("token"), session.secret);
  assert.notEqual(token, sign({ ...payload, url: "https://outro.local/documento.docx" }));
});

test("a origem e o comando não podem ser escolhidos pelo chamador", () => {
  const result = buildComparisonCommand({ ...session, url: "https://outro.local", c: "insert-text" }, "https://docs.local", () => "assinatura");
  assert.equal(new URL(result.url).origin, "https://docs.local");
  assert.equal(result.c, "compare");
});

test("recusa sessões encerradas, outros tipos e metadados incompletos", () => {
  for (const invalid of [{ ...session, kind: "pdf" }, { ...session, fileType: "pdf" }, { ...session, closedAt: "2026-11-06" },
    { ...session, id: "../outro" }, { ...session, secret: "" }, { ...session, filename: "" }]) {
    assert.throws(() => buildComparisonCommand(invalid, "https://docs.local", () => "assinatura"));
  }
});

test("não publica um comando se a assinatura falhar", () => {
  assert.throws(() => buildComparisonCommand(session, "https://docs.local", () => { throw new Error("assinatura indisponível"); }));
  assert.throws(() => buildComparisonCommand(session, "file:///arquivo", () => "assinatura"));
});

test("endpoint do broker exige autenticação e entrega um comando verificável para a sessão", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const vm = require("node:vm");
  const scratch = await fs.mkdtemp(path.join(__dirname, "comparison-test-"));
  const bearer = "acesso-do-broker-apenas-para-este-teste";
  const jwtSecret = "assinatura-do-editor-apenas-para-este-teste";
  try {
    const dir = path.join(scratch, "files/dev-sessions", session.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(session));
    await fs.writeFile(path.join(dir, session.filename), "arquivo de teste");
    const source = await fs.readFile(process.env.OKAI_COMPARISON_SERVER_PATH || path.join(__dirname, "server.js"), "utf8");
    const context = { require: name => name === "http" ? { createServer: () => ({ listen() {}, on() {} }) } : require(name),
      __dirname: scratch, URL, Buffer, console, process: { env: { OKD_JWT_SECRET: jwtSecret, OKD_DEMO_ACCESS_TOKEN: bearer } },
      setTimeout, clearTimeout };
    vm.createContext(context);
    vm.runInContext(source + "\nthis.endpoint = handleBrokerApi;", context);
    const url = new URL(`http://localhost/api/dev-sessions/${session.id}/comparison`);
    const invoke = async headers => {
      const response = { status: 0, writeHead(status) { this.status = status; }, end(data) { this.body = JSON.parse(data); } };
      assert.equal(await context.endpoint({ method: "POST", headers }, response, url), true);
      return response;
    };
    assert.equal((await invoke({})).status, 401);
    const response = await invoke({ authorization: `Bearer ${bearer}` });
    assert.equal(response.status, 200);
    const [header, payload, signature] = response.body.token.split(".");
    const expected = crypto.createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url");
    assert.equal(signature, expected);
    const signed = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(signed.c, response.body.c);
    assert.equal(signed.url, response.body.url);
    assert.equal(signed.fileType, response.body.fileType);
    assert.ok(signed.exp > signed.iat);
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
});
