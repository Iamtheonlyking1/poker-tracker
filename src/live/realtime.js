// Minimal Supabase Realtime (Phoenix Channels) client — postgres_changes only,
// no deps. It is an optimisation, never load-bearing: src/live/session.js also
// polls, so a dropped or broken socket just means a few seconds more latency.

export function createRealtime({ url, apikey, getToken }) {
  let ws = null;
  let ref = 0;
  let hb = null;
  let backoff = 1000;
  let closed = true;
  const channels = new Map(); // topic -> { filters, onInsert, joined }

  const nextRef = () => String(++ref);
  const send = (topic, event, payload) => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ topic, event, payload, ref: nextRef() }));
      return true;
    }
    return false;
  };

  async function joinChannel(topic, ch) {
    let token = '';
    try {
      token = (await getToken()) || '';
    } catch (e) {
      /* ignore — RLS join will just fail and we fall back to polling */
    }
    ch.joined = send(topic, 'phx_join', {
      config: {
        postgres_changes: ch.filters,
        broadcast: { self: false },
        private: false,
      },
      access_token: token,
    });
  }

  function open() {
    if (closed || typeof WebSocket === 'undefined') return;
    try {
      ws = new WebSocket(`${url}/realtime/v1/websocket?apikey=${encodeURIComponent(apikey)}&vsn=1.0.0`);
    } catch (e) {
      return;
    }
    ws.onopen = () => {
      backoff = 1000;
      clearInterval(hb);
      hb = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
      for (const [topic, ch] of channels) joinChannel(topic, ch);
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      handle(m);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch (_) {}
    };
    ws.onclose = () => {
      clearInterval(hb);
      if (!closed) {
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 15000);
      }
    };
  }

  function handle(m) {
    if (m.event !== 'postgres_changes') return;
    const data = m.payload && m.payload.data;
    if (!data || data.type !== 'INSERT') return;
    const ch = channels.get(m.topic);
    if (ch && data.record) ch.onInsert(data.record);
  }

  return {
    /** Begin/resume the socket. */
    connect() {
      closed = false;
      if (!ws || ws.readyState > 1) open();
    },

    /** Subscribe to INSERTs on `public.<table>` matching `filter` (e.g. "game_id=eq.<uuid>"). */
    subscribeInserts(table, filter, onInsert) {
      const topic = `realtime:pn:${table}:${filter}`;
      const ch = { filters: [{ event: 'INSERT', schema: 'public', table, filter }], onInsert, joined: false };
      channels.set(topic, ch);
      if (ws && ws.readyState === 1) joinChannel(topic, ch);
      else this.connect();
      return () => {
        send(topic, 'phx_leave', {});
        channels.delete(topic);
      };
    },

    /** Push a refreshed JWT to every channel (tokens expire hourly). */
    setToken(token) {
      for (const topic of channels.keys()) send(topic, 'access_token', { access_token: token });
    },

    close() {
      closed = true;
      clearInterval(hb);
      try {
        ws && ws.close();
      } catch (_) {}
      ws = null;
    },
  };
}
