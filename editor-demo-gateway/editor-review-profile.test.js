// Unit: contrato do perfil opt-in; não depende de rede ou documento real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installReviewProfile, installReviewLabels, installSearchInRibbon } = require('./editor-review-profile');

function editor(frame = 'office_revisao_teste', docReady = true) {
  const toolbar = new EventEmitter();
  const center = new EventEmitter();
  const apiEvents = new EventEmitter();
  const settings = new Map();
  const item = { height: 94 };
  let tracking = false, display = 'final', ready = true, observe;
  toolbar.getTab = () => ready ? { length: 1 } : undefined;
  toolbar.setTab = tab => { toolbar.selected = tab; toolbar.emit('tab:active', [tab]); center.emit('tab:active', [tab]); };
  center.trigger = center.emit.bind(center);
  const api = {
    asc_SetLocalTrackRevisions(value) { tracking = value; apiEvents.emit('asc_onOnTrackRevisionsChange', value, false); },
    asc_SetDisplayModeInReview(value) { display = value; },
    asc_registerCallback: apiEvents.on.bind(apiEvents),
    asc_unregisterCallback: apiEvents.off.bind(apiEvents),
  };
  const controllers = {
    Toolbar: { getView: () => toolbar },
    Viewport: { getView: () => ({ vlayout: { getItem: () => item } }) },
    Main: { api, _isDocReady: docReady },
  };
  const win = {
    location: { search: '?frameEditorId=' + frame },
    document: { documentElement: {}, querySelector: () => ({ getBoundingClientRect: () => ({ height: 66 }) }) },
    DE: { getController: name => controllers[name] },
    Common: { NotificationCenter: center, Utils: { InternalSettings: settings } },
    Asc: { c_oAscDisplayModeInReview: { Edit: 'markup' } },
    MutationObserver: class { constructor(callback) { observe = callback; } observe() {} disconnect() {} },
    addEventListener() {}, queueMicrotask,
  };
  return { win, toolbar, center, api, apiEvents, item, settings,
    tracking: () => tracking, display: () => display, observe: () => observe(),
    setReady: value => { ready = value; } };
}

test('restringe a revisão à aba nativa e libera os 28px das abas', async () => {
  const e = editor();
  const cleanup = installReviewProfile(e.win);
  await Promise.resolve();
  assert.equal(e.toolbar.selected, 'review');
  assert.equal(e.item.height, 66);
  assert.equal(e.settings.get('toolbar-height-tabs'), 0);
  assert.equal(e.tracking(), true);
  assert.equal(e.display(), 'markup');
  e.toolbar.setTab('home');
  assert.equal(e.toolbar.selected, 'review');
  e.api.asc_SetLocalTrackRevisions(false);
  assert.equal(e.tracking(), true);
  cleanup();
  e.toolbar.setTab('home');
  e.api.asc_SetLocalTrackRevisions(false);
  assert.equal(e.toolbar.selected, 'home');
  assert.equal(e.tracking(), false);
  assert.equal(e.center.listenerCount('app:ready'), 0);
});

test('aguarda o documento ficar pronto antes de ativar rastreamento', async () => {
  const e = editor('office_revisao_teste', false);
  e.setReady(false);
  installReviewProfile(e.win);
  assert.equal(e.toolbar.selected, undefined);
  e.setReady(true);
  e.observe();
  assert.equal(e.toolbar.selected, 'review');
  assert.equal(e.tracking(), false);
  e.center.trigger('app:ready');
  await Promise.resolve();
  assert.equal(e.tracking(), true);
  assert.equal(e.display(), 'markup');
});

test('preserva o editor comum e a comparação estática', () => {
  for (const frame of ['office_comparacao_teste', 'editor_teste', '']) {
    const e = editor(frame);
    installReviewProfile(e.win)();
    assert.equal(e.toolbar.selected, undefined);
    assert.equal(e.item.height, 94);
    assert.equal(e.tracking(), false);
    assert.equal(e.settings.size, 0);
    assert.equal(e.apiEvents.eventNames().length, 0);
  }
});

// Regressão material: o getter nativo ainda não está disponível no início do bootstrap.
test('aguarda os controles renderizados antes de consultar a view nativa', () => {
  const e = editor();
  let rendered = false, reads = 0, updates = 0;
  const button = () => ({ rendered: true, setCaption() { updates++; }, updateHint() { updates++; } });
  const view = { btnPrev: button(), btnNext: button() };
  e.win.location = { pathname: '/web-apps/apps/documenteditor/main/index.html', search: '?lang=pt' };
  e.win.document.querySelector = () => rendered ? {} : null;
  e.win.DE.getController = () => ({ getView() { reads++; if (!rendered) throw new Error('View indisponível durante bootstrap'); return view; } });
  installReviewLabels(e.win);
  e.observe();
  assert.equal(reads, 0);
  assert.equal(updates, 0);
  rendered = true;
  e.observe();
  assert.equal(reads, 1);
  assert.equal(updates, 4);
});

test('visualizador mantém os controles de Exibir sem abas e sem ativar rastreamento', async () => {
  const e = editor('office_comparacao_teste');
  e.win.location.search += '&mode=view';
  const cleanup = installReviewProfile(e.win);
  await Promise.resolve();
  assert.equal(e.toolbar.selected, 'view');
  assert.equal(e.item.height, 66);
  assert.equal(e.tracking(), false);
  assert.equal(e.apiEvents.listenerCount('asc_onOnTrackRevisionsChange'), 0);
  cleanup();
});

test('pesquisa continua sendo o botão nativo com seu estado de ligar e desligar', () => {
  const e = editor('office_comparacao_teste');
  e.win.location.search += '&mode=view';
  const classes = new Set(['btn-header']);
  const button = { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } };
  const slot = { classList: { add() {} }, querySelector: () => button };
  function element() { return { children: [], appendChild(child) { this.children.push(child); return child; } }; }
  const panel = element();
  let caption;
  const native = { rendered: true, pressed: true, setCaption(value) { caption = value; } };
  e.win.DE.getController('Viewport').header = { btnSearch: native };
  e.win.document.getElementById = () => slot;
  e.win.document.querySelector = () => panel;
  e.win.document.createElement = element;
  installSearchInRibbon(e.win);
  assert.equal(panel.children.length, 1);
  assert.equal(panel.children[0].children[0].children[0], slot);
  assert.equal(caption, 'Pesquisar');
  assert.equal(native.pressed, true);
  assert.equal(classes.has('btn-toolbar'), true);
  assert.equal(classes.has('btn-header'), false);
});
