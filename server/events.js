import { AsyncLocalStorage } from 'node:async_hooks';

// Server-sent events so every open editor (and anything else listening) learns about changes made
// elsewhere: another tab, the timeline-generation skill, or a project switch.

/** Per-request context: { client } is the X-Client id of the browser tab that made the request. */
export const requestContext = new AsyncLocalStorage();

const listeners = new Set();
const HEARTBEAT_MS = 25000;

/** GET /api/events: keep the response open and stream events to it. */
export function subscribe(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');
  listeners.add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(beat);
    listeners.delete(res);
  });
}

/** Send `event` to every listener, tagged with the tab that caused it (so that tab can ignore its own changes). */
export function broadcast(event) {
  const data = `data: ${JSON.stringify({ ...event, origin: requestContext.getStore()?.client ?? null })}\n\n`;
  for (const res of listeners) res.write(data);
}
