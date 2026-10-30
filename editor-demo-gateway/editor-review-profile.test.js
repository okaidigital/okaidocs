// Unit: contrato do perfil opt-in; não depende de rede ou documento real.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installReviewProfile } = require('./editor-review-profile');

function editor(frame = 'office_revisao_teste', docReady = true) {
  const toolbar = new EventEmitter();
  const center = new EventEmitter();
  const apiEvents = new EventEmitter();
  const settings = new Map();
  const item = { height: 94 };
  let tracking = false, display = 'final', ready = true, observe;
  toolbar.getTab = () => ready ? { length: 1 } : undefined;
  toolbar.setTab = tab => { toolbar.selected = tab; toolbar.emit('tab:active', tab); };
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
