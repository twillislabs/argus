// Live event updates over /ws/live, with automatic reconnect.

import type { EventItem } from './api';

export type LiveState = 'connecting' | 'live' | 'offline';

export function connectLive(
  onEvents: (events: EventItem[]) => void,
  onState: (state: LiveState) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  let timer: number | undefined;

  const open = () => {
    onState('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws/live');
    ws.onopen = () => {
      delay = 1000;
      onState('live');
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data));
        if (data.type === 'events' && Array.isArray(data.events)) onEvents(data.events);
      } catch {
        // Ignore malformed messages.
      }
    };
    ws.onclose = () => {
      onState('offline');
      if (closed) return;
      timer = window.setTimeout(open, delay);
      delay = Math.min(30000, delay * 2);
    };
  };
  open();
  return () => {
    closed = true;
    window.clearTimeout(timer);
    ws?.close();
  };
}
