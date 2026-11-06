const test = require("node:test");
const assert = require("node:assert/strict");
const { hasSignedEditorDownload } = require("./editor-download-auth");
const docId = "copia-de-comparacao";
const path = "/9.3.1-build/downloadas/" + docId;
const command = { c: "save", id: docId, url: "http://gateway/broker/files/copia/revisao.docx", format: "docx", tokenDownload: "assinatura-opaca" };
const signed = { c: "compare", url: command.url, fileType: "docx" };
const url = (cmd=command, route=path) => new URL("https://docs.local" + route + "?cmd=" + encodeURIComponent(JSON.stringify(cmd)));
const allow = (cmd=command, claims=signed, route=path, method="POST") => hasSignedEditorDownload({ method }, url(cmd, route), () => claims);

test("aceita a conversão nativa com comando assinado, sem depender de cookie", () => {
  assert.equal(allow(), true);
  assert.equal(allow(command, signed, "/downloadas/"+docId), true);
});
test("vincula a assinatura à URL e ao formato enviados", () => {
  assert.equal(allow({...command,url:"https://outro.local/arquivo.docx"}), false);
  assert.equal(allow({...command,format:"xlsx"}), false);
  assert.equal(allow(command,{...signed,c:"forcesave"}), false);
});
test("exige a assinatura válida e a identidade do documento no caminho", () => {
  assert.equal(hasSignedEditorDownload({method:"POST"},url(),()=>{throw new Error("JWT inválido ou expirado");}),false);
  assert.equal(allow({...command,id:"outro"}),false);
  assert.equal(allow({...command,tokenDownload:undefined}),false);
});
test("preserva a autenticação das outras rotas e comandos", () => {
  assert.equal(allow(command,signed,"/command"),false);
  assert.equal(allow(command,signed,path,"GET"),false);
  assert.equal(allow({...command,c:"sendmm"}),false);
  assert.equal(hasSignedEditorDownload({method:"POST"},new URL("https://docs.local"+path+"?cmd=invalido"),()=>signed),false);
});
test("download comum exige sessão assinada, documento correspondente e permissão", () => {
  const cmd={c:"savefromorigin",id:docId,tokenSession:"sessao-opaca"};
  const claims={document:{key:docId,permissions:{download:true,print:false}}};
  assert.equal(allow(cmd,claims),true);
  assert.equal(allow(cmd,{document:{key:"outro"}}),false);
  assert.equal(allow(cmd,{document:{key:docId,permissions:{download:false,print:false}}}),false);
});
