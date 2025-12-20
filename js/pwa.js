(() => {
  const isSecureContext =
    window.isSecureContext ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';

  if (!('serviceWorker' in navigator) || !isSecureContext) return;

  window.addEventListener('load', () => {
    // iOS "Add to Home Screen" can get stuck on an older SW + CacheStorage even after
    // a deploy. Registering with a versioned URL forces a fresh SW script fetch.
    const SW_VERSION = '27';
    const SW_URL = `/sw.js?v=${SW_VERSION}`;

    navigator.serviceWorker
      .register(SW_URL, { updateViaCache: 'none' })
      .then((reg) => {
        try {
          reg.update?.();
        } catch {}
      })
      .catch(() => {});
  });
})();
