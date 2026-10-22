import { useEffect, useRef, useState } from 'react';

const pollIntervalMs = 3000;
const requestTimeoutMs = 2500;
const maxEvents = 6;

// Interroge /health et journalise les vraies transitions : panne détectée, puis service rétabli.
export function useServiceStatus(apiUrl) {
  const [status, setStatus] = useState({ state: 'checking', database: null, latencyMs: null, checkedAt: null });
  const [events, setEvents] = useState([]);
  const downSince = useRef(null);
  const lastState = useRef('checking');

  useEffect(() => {
    let cancelled = false;

    function record(event) {
      setEvents((current) => [{ id: `${event.type}-${Date.now()}`, ...event }, ...current].slice(0, maxEvents));
    }

    async function check() {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      const startedAt = performance.now();
      let next;
      try {
        const response = await fetch(`${apiUrl}/health`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        next = {
          state: response.ok && body.status === 'ok' ? 'up' : 'down',
          database: body.database ?? 'unavailable',
          latencyMs: Math.round(performance.now() - startedAt),
        };
      } catch {
        next = { state: 'down', database: 'unavailable', latencyMs: null };
      } finally {
        window.clearTimeout(timeout);
      }
      if (cancelled) return;

      const now = new Date();
      setStatus({ ...next, checkedAt: now });

      if (next.state === 'down' && lastState.current !== 'down') {
        downSince.current = now;
        if (lastState.current === 'up') record({ type: 'down', at: now });
      }
      if (next.state === 'up' && lastState.current === 'down' && downSince.current) {
        record({ type: 'recovered', at: now, seconds: Math.round((now - downSince.current) / 1000) });
        downSince.current = null;
      }
      lastState.current = next.state;
    }

    check();
    const interval = window.setInterval(check, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [apiUrl]);

  return { status, events };
}
