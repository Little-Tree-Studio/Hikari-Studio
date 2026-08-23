(() => {
  const config = window.__HIKARI_RPC__;
  if (!config?.baseUrl || !config?.token) return;

  const pending = new Map();
  const requestTimeoutMs = 120000;
  let sequence = 0;

  const api = new Proxy({}, {
    get(_target, method) {
      // An async function probes returned objects for `then`. Do not expose
      // the RPC proxy as a thenable, or that probe becomes an API call.
      if (method === 'then') return undefined;
      return (...args) => {
        const requestId = `${Date.now().toString(36)}-${sequence += 1}`;
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), requestTimeoutMs);
        const promise = fetch(`${config.baseUrl}/rpc`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requestId, method: String(method), args }),
          signal: controller.signal,
        }).then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.ok === false) {
            const error = new Error(payload.error?.message || payload.detail || `Desktop API failed (${response.status})`);
            error.name = payload.error?.type || 'DesktopApiError';
            throw error;
          }
          return payload.value;
        }).finally(() => {
          window.clearTimeout(timer);
          pending.delete(requestId);
        });
        pending.set(requestId, { controller, promise });
        return promise;
      };
    },
  });

  window.__HIKARI_DESKTOP__ = true;
  window.pywebview = { api };
  window.dispatchEvent(new Event('pywebviewready'));
})();
