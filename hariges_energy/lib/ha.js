export class HomeAssistant {
  constructor(url, token) { this.url = url?.replace(/\/$/, ''); this.token = token; }
  get configured() { return Boolean(this.url && this.token); }
  async request(path) {
    if (!this.configured) throw Object.assign(new Error('Home Assistant não configurado'), { status: 503 });
    const response = await fetch(`${this.url}${path}`, { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error(`Home Assistant respondeu ${response.status}`), { status: 502 });
    return response.json();
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
