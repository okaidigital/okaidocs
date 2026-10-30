/* Perfil da revisão da plataforma: usa os eventos e o layout nativos do editor. */
(function (root) {
  // Configura os textos dos próprios componentes, também no editor comum.
  function installReviewLabels(win) {
    if (!/\/documenteditor\//.test(win.location.pathname)) return;
    const lang = new URLSearchParams(win.location.search).get('lang') || '';
    if (!/^pt(?:[-_]|$)/i.test(lang)) return;
    const observer = new win.MutationObserver(prepare);
    function prepare() {
      // A view só pode ser consultada depois que seus controles forem renderizados.
      if (!win.document.querySelector('#btn-change-prev button')
          || !win.document.querySelector('#btn-change-next button')) return;
      const app = win.DE;
      if (!app?.getController) return;
      const view = app.getController('Common.Controllers.ReviewChanges')?.getView();
      if (!view?.btnPrev?.rendered || !view?.btnNext?.rendered) return;
      observer.disconnect();
      view.txtPrev = view.hintPrev = 'Alteração anterior';
      view.txtNext = view.hintNext = 'Próxima alteração';
      view.btnPrev.setCaption(view.txtPrev);
      view.btnPrev.updateHint(view.hintPrev);
      view.btnNext.setCaption(view.txtNext);
      view.btnNext.updateHint(view.hintNext);
    }
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    win.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    prepare();
  }

  function installReviewProfile(win) {
    const params = new URLSearchParams(win.location.search);
    const frame = params.get('frameEditorId') || '';
    const review = frame.startsWith('office_revisao_');
    const viewer = frame.startsWith('office_comparacao_') && params.get('mode') === 'view';
    if (!review && !viewer) return () => {};
    const tab = review ? 'review' : 'view';
    let installed = false;
    let disposed = false;
    let removeNativeEvents = () => {};
    const observer = new win.MutationObserver(prepare);
    function prepare() {
      if (installed) return;
      const app = win.DE;
      const center = win.Common?.NotificationCenter;
      const settings = win.Common?.Utils?.InternalSettings;
      if (!app?.getController || !center || !settings) return;
      const toolbar = app.getController('Toolbar')?.getView('Toolbar');
      const viewport = app.getController('Viewport')?.getView('Viewport');
      const main = app.getController('Main');
      const api = main?.api;
      const controls = win.document.querySelector('#toolbar .box-controls');
      if (!toolbar?.getTab(tab)?.length || !viewport?.vlayout?.getItem('toolbar')
          || !controls || controls.getBoundingClientRect().height <= 0
          || (review && typeof api?.asc_SetLocalTrackRevisions !== 'function')) return;
      installed = true;
      observer.disconnect();
      const restrictTab = activeTab => {
        const active = Array.isArray(activeTab) ? activeTab[0] : activeTab;
        if (active !== tab) toolbar.setTab(tab);
      };
      const maintainTracking = (local, global) => {
        if (!(local === null ? global : local)) api.asc_SetLocalTrackRevisions(true);
      };
      const applyLayout = () => {
        toolbar.setTab(tab);
        const height = controls.getBoundingClientRect().height;
        settings.set('toolbar-height-tabs', 0);
        settings.set('toolbar-height-tabs-top-title', 0);
        settings.set('toolbar-height-compact', height);
        settings.set('toolbar-height-normal', height);
        viewport.vlayout.getItem('toolbar').height = height;
        center.trigger('layout:changed', 'toolbar');
      };
      const ready = () => win.queueMicrotask(() => {
        if (disposed) return;
        applyLayout();
        if (review) {
          api.asc_SetLocalTrackRevisions(true);
          api.asc_SetDisplayModeInReview(win.Asc.c_oAscDisplayModeInReview.Edit);
        }
      });
      center.on('tab:active', restrictTab);
      center.on('app:ready', ready);
      if (review) api.asc_registerCallback('asc_onOnTrackRevisionsChange', maintainTracking);
      removeNativeEvents = () => {
        center.off('tab:active', restrictTab);
        center.off('app:ready', ready);
        if (review) api.asc_unregisterCallback('asc_onOnTrackRevisionsChange', maintainTracking);
      };
      applyLayout();
      if (main._isDocReady) ready();
    }
    function cleanup() { disposed = true; observer.disconnect(); removeNativeEvents(); }
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    win.addEventListener('pagehide', cleanup, { once: true });
    prepare();
    return cleanup;
  }

  // Move o mesmo botão nativo: o estado pressionado, os atalhos e a busca continuam sob controle do editor.
  function installSearchInRibbon(win) {
    const params = new URLSearchParams(win.location.search);
    const frame = params.get('frameEditorId') || '';
    const review = frame.startsWith('office_revisao_');
    if (!review && !(frame.startsWith('office_comparacao_') && params.get('mode') === 'view')) return;
    const observer = new win.MutationObserver(prepare);
    function prepare() {
      const header = win.DE?.getController('Viewport')?.header;
      const slot = win.document.getElementById('slot-btn-search');
      const panel = win.document.querySelector(`#toolbar .panel[data-tab="${review ? 'review' : 'view'}"]`);
      if (!header?.btnSearch?.rendered || !slot?.querySelector('button') || !panel) return;
      observer.disconnect();
      const group = win.document.createElement('div');
      group.className = 'group small okai-search-group';
      const row = win.document.createElement('div');
      row.className = 'elset';
      slot.classList.add('text');
      row.appendChild(slot);
      group.appendChild(row);
      group.appendChild(win.document.createElement('div')).className = 'elset';
      panel.appendChild(group);
      const button = slot.querySelector('button');
      button.classList.remove('btn-header');
      button.classList.add('btn-toolbar');
      header.btnSearch.setCaption('Pesquisar');
      win.Common?.NotificationCenter?.trigger('layout:changed', 'toolbar');
    }
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    win.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    prepare();
  }

  if (typeof module === 'object' && module.exports) module.exports = { installReviewProfile, installReviewLabels, installSearchInRibbon };
  else { installReviewLabels(root); installReviewProfile(root); installSearchInRibbon(root); }
})(typeof window === 'undefined' ? null : window);
