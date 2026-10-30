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
    const frame = new URLSearchParams(win.location.search).get('frameEditorId') || '';
    if (!frame.startsWith('office_revisao_')) return () => {};
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
      if (!toolbar?.getTab('review')?.length || !viewport?.vlayout?.getItem('toolbar')
          || !controls || controls.getBoundingClientRect().height <= 0
          || typeof api?.asc_SetLocalTrackRevisions !== 'function') return;
      installed = true;
      observer.disconnect();
      const restrictTab = tab => {
        const active = Array.isArray(tab) ? tab[0] : tab;
        if (active !== 'review') toolbar.setTab('review');
      };
      const maintainTracking = (local, global) => {
        if (!(local === null ? global : local)) api.asc_SetLocalTrackRevisions(true);
      };
      const applyLayout = () => {
        toolbar.setTab('review');
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
        api.asc_SetLocalTrackRevisions(true);
        api.asc_SetDisplayModeInReview(win.Asc.c_oAscDisplayModeInReview.Edit);
      });
      center.on('tab:active', restrictTab);
      center.on('app:ready', ready);
      api.asc_registerCallback('asc_onOnTrackRevisionsChange', maintainTracking);
      removeNativeEvents = () => {
        center.off('tab:active', restrictTab);
        center.off('app:ready', ready);
        api.asc_unregisterCallback('asc_onOnTrackRevisionsChange', maintainTracking);
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
  if (typeof module === 'object' && module.exports) module.exports = { installReviewProfile, installReviewLabels };
  else { installReviewLabels(root); installReviewProfile(root); }
})(typeof window === 'undefined' ? null : window);
