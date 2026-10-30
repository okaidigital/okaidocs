/* Perfil da revisão da plataforma: usa os eventos e o layout nativos do editor. */
(function (root) {
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
      const restrictTab = tab => { if (tab !== 'review') toolbar.setTab('review'); };
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
  if (typeof module === 'object' && module.exports) module.exports = { installReviewProfile };
  else installReviewProfile(root);
})(typeof window === 'undefined' ? null : window);
