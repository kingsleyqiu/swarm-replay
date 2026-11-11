(function () {
  'use strict';
  if (globalThis.SwarmReplayExtension) return;

  const html = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let replay;
  let preparing;
  let automatic = false;
  let currentRoute = location.pathname + location.search;

  function clearPreparation() {
    preparing?.abort();
    preparing = null;
    html.removeAttribute('data-swr-preparing');
  }

  function play(waitForRoute = false) {
    clearPreparation();
    replay = globalThis.SwarmReplay.mount();
    replay.play(waitForRoute);
  }

  function autoplay() {
    automatic = true;
    if (motion.matches || replay || preparing) return;
    if (document.readyState !== 'loading') {
      play();
      return;
    }
    preparing = new AbortController();
    const { signal } = preparing;
    const ready = () => {
      if (!signal.aborted && document.body) play();
      else clearPreparation();
    };
    const deadline = setTimeout(ready, 750);
    signal.addEventListener('abort', () => clearTimeout(deadline), { once: true });
    document.addEventListener('DOMContentLoaded', ready, { once: true, signal });
    html.setAttribute('data-swr-preparing', globalThis.SwarmReplay.hasSharedRegions() ? 'content' : 'page');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autoplay?.newValue === false) {
      automatic = false;
      clearPreparation();
      replay?.stop();
    }
  });
  function onRouteChange() {
    const nextRoute = location.pathname + location.search;
    if (nextRoute === currentRoute) return;
    currentRoute = nextRoute;
    if (automatic && !motion.matches && !replay?.running && document.body) play(true);
  }
  window.navigation?.addEventListener('currententrychange', onRouteChange);
  window.addEventListener('popstate', onRouteChange);
  window.addEventListener('pagehide', clearPreparation);

  motion.addEventListener('change', () => {
    if (!motion.matches) return;
    clearPreparation();
    replay?.stop();
  });

  globalThis.SwarmReplayExtension = { play, autoplay };
})();
