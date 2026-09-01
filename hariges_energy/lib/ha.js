import WebSocket from 'ws';

export class HomeAssistant {
  constructor(url, token) { this.url = url?.replace(/\/$/, ''); this.token = token; }
  get configured() { return Boolean(this.url && this.token); }
  async request(path) {
    if (!this.configured) throw Object.assign(new Error('Home Assistant não configurado'), { status: 503 });
    const response = await fetch(`${this.url}${path}`, { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error(`Home Assistant respondeu ${response.status}`), { status: 502 });
    return response.json();
  }
  async binary(path) {
    if (!this.configured) throw Object.assign(new Error('Home Assistant n�o configurado'), { status: 503 });
    const response = await fetch(`${this.url}${path}`, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error(`Home Assistant respondeu ${response.status}`), { status: 502 });
    return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'application/octet-stream' };
  }
  async currentUser(accessToken) {
    if (!this.url || !accessToken) throw Object.assign(new Error('Credencial do Home Assistant ausente'), { status: 401 });
    const websocketUrl = this.url.includes('supervisor/core')
      ? 'ws://homeassistant:8123/api/websocket'
      : `${this.url.replace(/^http/, 'ws')}/api/websocket`;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(Object.assign(new Error('Tempo esgotado ao validar administrador'), { status: 504 }));
      }, 10000);
      const finish = (callback, result) => {
        clearTimeout(timer);
        socket.close();
        callback(result);
      };
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
        else if (message.type === 'auth_invalid') finish(reject, Object.assign(new Error('Credencial do Home Assistant invalida'), { status: 401 }));
        else if (message.type === 'auth_ok') socket.send(JSON.stringify({ id: 1, type: 'auth/current_user' }));
        else if (message.type === 'result' && message.id === 1) {
          if (!message.success) finish(reject, Object.assign(new Error('Nao foi possivel validar o administrador'), { status: 403 }));
          else finish(resolve, message.result);
        }
      });
      socket.on('error', () => finish(reject, Object.assign(new Error('Falha ao conectar ao Home Assistant'), { status: 502 })));
    });
  }
  async states(ids) {
    const states = await Promise.all(ids.map(async id => {
      try { return await this.request(`/api/states/${encodeURIComponent(id)}`); }
      catch { return { entity_id: id, state: 'unavailable', attributes: {} }; }
    }));
    return Object.fromEntries(states.map(item => [item.entity_id, { value: item.state, unit: item.attributes?.unit_of_measurement || '', name: item.attributes?.friendly_name || item.entity_id, updated: item.last_updated }]));
  }
  async history(ids, hours = 24) {
    const start = new Date(Date.now() - Math.min(Math.max(hours, 1), 168) * 3600000).toISOString();
    return this.request(`/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(ids.join(','))}&minimal_response&no_attributes`);
  }
}
