const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const state = { me: null, dashboards: [], active: null, timer: null };
let visualSequence = 0;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Falha na solicitacao'), { status: response.status });
  return data;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function value(item) {
  const parsed = Number(item?.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(input, decimals = 1) {
  const parsed = typeof input === 'number' ? input : Number(input?.value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : '\u2014';
}

function historyMap(payload) {
  const mapped = {};
  (payload.history || []).forEach((series, index) => {
    const entityId = series.find(point => point.entity_id)?.entity_id || payload.entities?.[index];
    if (!entityId) return;
    mapped[entityId] = series
      .map(point => ({
        y: Number(point.state),
        t: new Date(point.last_changed || point.last_updated).getTime()
      }))
      .filter(point => Number.isFinite(point.y) && Number.isFinite(point.t));
  });
  return mapped;
}

function lineChart(history, series, options = {}) {
  const available = series
    .map(item => ({ ...item, points: history[item.entity] || [] }))
    .filter(item => item.points.length > 1);

  if (!available.length) return '<div class="empty chart-empty">Historico ainda nao disponivel</div>';

  const width = 1200;
  const height = 270;
  const pad = { left: 52, right: 64, top: 18, bottom: 34 };
  const all = available.flatMap(item => item.points);
  const minTime = Math.min(...all.map(point => point.t));
  const maxTime = Math.max(...all.map(point => point.t));
  const rawMin = Math.min(...all.map(point => point.y));
  const rawMax = Math.max(...all.map(point => point.y));
  const spread = Math.max(0.001, rawMax - rawMin);
  const minY = options.min ?? Math.max(0, rawMin - spread * 0.18);
  const maxY = options.max ?? rawMax + spread * 0.18;
  const x = time => pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * (width - pad.left - pad.right);
  const y = reading => height - pad.bottom - ((reading - minY) / Math.max(0.001, maxY - minY)) * (height - pad.top - pad.bottom);
  const pathFor = points => points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.t).toFixed(1)} ${y(point.y).toFixed(1)}`).join(' ');
  const chartId = `chart-${visualSequence++}`;
  const first = available[0];
  const firstPath = pathFor(first.points);
  const area = options.area
    ? `<path class="chart-area" d="${firstPath} L ${x(first.points.at(-1).t).toFixed(1)} ${height - pad.bottom} L ${x(first.points[0].t).toFixed(1)} ${height - pad.bottom} Z" fill="url(#${chartId}-area)"/>`
    : '';
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const yy = pad.top + ratio * (height - pad.top - pad.bottom);
    const label = maxY - ratio * (maxY - minY);
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}"/><text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end">${format(label, options.decimals ?? 1)} ${esc(options.unit || '')}</text>`;
  }).join('');
  const timeLabels = Array.from({ length: 7 }, (_, index) => {
    const ratio = index / 6;
    const time = minTime + ratio * (maxTime - minTime);
    const xx = pad.left + ratio * (width - pad.left - pad.right);
    return `<text class="time-label" x="${xx}" y="${height - 8}" text-anchor="middle">${new Date(time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</text>`;
  }).join('');
  const paths = available.map(item => `<path class="series-line" d="${pathFor(item.points)}" stroke="${item.color}"/>`).join('');
  const endLabels = available.map(item => {
    const last = item.points.at(-1);
    return `<circle cx="${x(last.t)}" cy="${y(last.y)}" r="3" fill="${item.color}"/><text class="end-label" x="${x(last.t) + 7}" y="${y(last.y) + 4}" fill="${item.color}">${format(last.y, item.decimals ?? options.decimals ?? 1)} ${esc(options.unit || '')}</text>`;
  }).join('');

  return `
    <div class="chart-legend">${available.map(item => `<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join('')}</div>
    <div class="range-chips"><span>1h</span><span>6h</span><span>12h</span><strong>24h</strong><span>Tudo</span></div>
    <svg class="history-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(options.label || 'Historico')}">
      <defs>
        <linearGradient id="${chartId}-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${first.color}" stop-opacity=".22"/>
          <stop offset="1" stop-color="${first.color}" stop-opacity=".02"/>
        </linearGradient>
      </defs>
      <g class="chart-grid">${grid}</g>
      ${area}
      ${paths}
      ${endLabels}
      ${timeLabels}
    </svg>`;
}

function gauge({ title, reading, unit, min, max, decimals, needleColor, mode = 'power', primary, secondary }) {
  const ratio = Math.min(1, Math.max(0, (reading - min) / Math.max(0.001, max - min)));
  const angle = Math.PI - ratio * Math.PI;
  const needleX = 120 + Math.cos(angle) * 66;
  const needleY = 116 - Math.sin(angle) * 66;
  const id = `gauge-${visualSequence++}`;
  const stops = mode === 'voltage'
    ? '<stop offset="0" stop-color="#ef4444"/><stop offset=".18" stop-color="#f97316"/><stop offset=".34" stop-color="#eab308"/><stop offset=".48" stop-color="#22c55e"/><stop offset=".66" stop-color="#22c55e"/><stop offset=".82" stop-color="#eab308"/><stop offset="1" stop-color="#ef4444"/>'
    : '<stop offset="0" stop-color="#22c55e"/><stop offset=".55" stop-color="#22c55e"/><stop offset=".72" stop-color="#84cc16"/><stop offset=".84" stop-color="#eab308"/><stop offset=".92" stop-color="#f97316"/><stop offset="1" stop-color="#ef4444"/>';

  return `<article class="surface gauge-card">
    <h3>${esc(title)}</h3>
    <svg class="gauge" viewBox="0 0 240 150" role="img" aria-label="${esc(title)}: ${format(reading, decimals)} ${esc(unit)}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>
      <path class="gauge-track" d="M 35 116 A 85 85 0 0 1 205 116"/>
      <path class="gauge-color" d="M 35 116 A 85 85 0 0 1 205 116" stroke="url(#${id})"/>
      <line class="gauge-needle" x1="120" y1="116" x2="${needleX.toFixed(1)}" y2="${needleY.toFixed(1)}" stroke="${needleColor}"/>
      <circle cx="120" cy="116" r="5" fill="${needleColor}"/>
      <text class="gauge-value" x="120" y="126" text-anchor="middle">${format(reading, decimals)} ${esc(unit)}</text>
      <text class="gauge-primary" x="120" y="142" text-anchor="middle">${esc(primary)}</text>
    </svg>
    <div class="gauge-secondary">${esc(secondary)}</div>
  </article>`;
}

function panelCard(dashboard, states) {
  if (!dashboard.panelImage || !dashboard.circuits?.length) return '';
  const total = value(states[dashboard.entities.power]);
  const status = states[dashboard.entities.status]?.value || 'Indisponivel';
  const positions = [{ left: 22, top: 75 }, { left: 40, top: 75 }, { left: 57, top: 75 }, { left: 65, top: 79 }];
  const labels = dashboard.circuits.map((circuit, index) => {
    const position = positions[index] || { left: 50, top: 85 };
    return `<span class="panel-label circuit-label" style="left:${position.left}%;top:${position.top}%;--label-color:${circuit.color}">${esc(circuit.id.toUpperCase())} \u00b7 ${esc(circuit.shortName)} \u00b7 ${format(value(states[circuit.entity]), 1)} W</span>`;
  }).join('');
  return `<article class="surface panel-card">
    <div class="panel-stage">
      <img src="/api/dashboards/${encodeURIComponent(dashboard.id)}/panel-image" alt="Quadro eletrico do setor ${esc(dashboard.name)}">
      <span class="panel-label status-label">QUADRO \u00b7 ${esc(status)}</span>
      <span class="panel-label total-label">GERAL \u00b7 ${format(total, 3)} kW</span>
      ${labels}
    </div>
  </article>`;
}

function sankeyCard(dashboard, states) {
  if (!dashboard.circuits?.length) return '';
  const total = Math.max(0, value(states[dashboard.entities.power]) * 1000);
  const circuits = dashboard.circuits.map(circuit => ({ ...circuit, watts: Math.max(0, value(states[circuit.entity])) }));
  const measured = circuits.reduce((sum, circuit) => sum + circuit.watts, 0);
  const flows = [...circuits, { id: 'other', name: 'Outros / nao medido', color: '#eab308', watts: Math.max(0, total - measured) }];
  const scale = 170 / Math.max(total, measured, 1);
  let sourceY = 126;
  const paths = flows.map((flow, index) => {
    const visibleWidth = Math.max(1.6, flow.watts * scale);
    const startY = sourceY + visibleWidth / 2;
    sourceY += visibleWidth;
    const targetY = 82 + index * 66;
    return `<path d="M 116 ${startY.toFixed(1)} C 350 ${startY.toFixed(1)}, 540 ${targetY}, 735 ${targetY}" stroke="${flow.color}" stroke-width="${visibleWidth.toFixed(1)}"/>`;
  }).join('');
  const nodes = flows.map((flow, index) => {
    const targetY = 82 + index * 66;
    return `<rect x="735" y="${targetY - 12}" width="14" height="24" rx="2" fill="${flow.color}"/><text class="sankey-label" x="850" y="${targetY - 2}" text-anchor="end">${esc(flow.id === 'other' ? flow.name : `${flow.id.toUpperCase()} \u00b7 ${flow.name}`)}</text><text class="sankey-value" x="850" y="${targetY + 14}" text-anchor="end">${format(flow.watts, 1)} W</text>`;
  }).join('');

  return `<article class="surface sankey-card">
    <h3>Potencia total e distribuicao por circuito</h3>
    <svg class="sankey" viewBox="0 0 880 420" role="img" aria-label="Distribuicao da potencia total entre os circuitos">
      <g class="sankey-links">${paths}</g>
      <rect x="96" y="124" width="20" height="174" rx="3" fill="#14b8a6"/>
      <text class="sankey-label" x="124" y="205">Potencia total geral</text>
      <text class="sankey-value" x="124" y="222">${format(total, 1)} W</text>
      ${nodes}
    </svg>
  </article>`;
}

async function init() {
  try {
    const data = await request('/api/me');
    state.me = data.user;
    state.dashboards = data.dashboards;
    state.active = data.dashboards[0]?.id;
    renderShell();
  } catch (error) {
    if (error.status === 401) renderLogin();
    else toast(error.message);
  }
}

function renderLogin(setup = false) {
  clearInterval(state.timer);
  app.innerHTML = `<section class="login-shell"><div class="login-brand"><div class="brand"><span class="brand-mark">\u03df</span> HARIGES</div><div class="login-copy"><div class="eyebrow">Inteligencia energetica</div><h1>Energia visivel.<br>Decisoes melhores.</h1><p>Acompanhe consumo, potencia e qualidade eletrica de cada setor em tempo real.</p></div><small>Monitoramento integrado ao Home Assistant</small></div><div class="login-panel"><form class="form-card" id="login-form"><div class="eyebrow">Acesso seguro</div><h2>${setup ? 'Primeiro acesso' : 'Bem-vindo'}</h2><p>${setup ? 'Crie a conta administradora.' : 'Entre com as credenciais do seu setor.'}</p>${setup ? '<div class="field"><label>Nome</label><input name="name" autocomplete="name" required></div>' : ''}<div class="field"><label>Usuario</label><input name="username" autocomplete="username" required autofocus></div><div class="field"><label>Senha</label><input type="password" name="password" autocomplete="current-password" minlength="10" required></div><div class="error" id="form-error"></div><button class="primary" type="submit">${setup ? 'Criar administrador' : 'Entrar no painel'}</button></form></div></section>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const body = Object.fromEntries(new FormData(event.target));
    try {
      if (setup) {
        await request('/api/setup', { method: 'POST', body: JSON.stringify(body) });
        toast('Administrador criado');
        renderLogin();
      } else {
        await request('/api/login', { method: 'POST', body: JSON.stringify(body) });
        await init();
      }
    } catch (error) {
      document.querySelector('#form-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function renderShell() {
  const nav = state.dashboards.map(dashboard => `<button class="nav-btn ${dashboard.id === state.active ? 'active' : ''}" data-dash="${dashboard.id}"><span style="color:${dashboard.color}">\u25cf</span> ${esc(dashboard.name)}</button>`).join('');
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">\u03df</span> HARIGES</div><nav class="side-nav">${nav}${state.me.role === 'admin' ? '<button class="nav-btn" data-admin>\u2699 <span>Acessos</span></button>' : ''}</nav><div class="side-user"><strong>${esc(state.me.name)}</strong><small>${state.me.role === 'admin' ? 'Administrador' : 'Visualizador'}</small><button class="nav-btn" data-logout>Sair</button></div></aside><section class="content" id="content"></section></div>`;
  document.querySelectorAll('[data-dash]').forEach(button => {
    button.onclick = () => {
      state.active = button.dataset.dash;
      renderShell();
    };
  });
  document.querySelector('[data-admin]')?.addEventListener('click', renderAdmin);
  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST' });
    renderLogin();
  });
  renderDashboard();
}

async function renderDashboard() {
  clearInterval(state.timer);
  const dashboard = state.dashboards.find(item => item.id === state.active);
  const content = document.querySelector('#content');
  if (!dashboard) {
    content.innerHTML = '<div class="empty">Nenhum setor foi liberado para este usuario.</div>';
    return;
  }
  content.innerHTML = `<header class="topbar"><div><div class="eyebrow">Monitoramento energetico</div><h1>Sala tecnica \u00b7 ${esc(dashboard.name)}</h1><p>Tensao, potencia e distribuicao dos circuitos em tempo real</p></div><div class="status"><i class="status-dot"></i><span id="updated">Conectando...</span></div></header><div id="live"><div class="empty">Carregando medicoes...</div></div>`;

  const refresh = async () => {
    try {
      const [{ states, timestamp }, historyData] = await Promise.all([
        request(`/api/dashboards/${dashboard.id}/live`),
        request(`/api/dashboards/${dashboard.id}/history?hours=24`).catch(() => ({ history: [], entities: [] }))
      ]);
      drawDashboard(dashboard, states, historyData);
      document.querySelector('#updated').textContent = `Atualizado ${new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      document.querySelector('#updated').textContent = error.message;
      document.querySelector('.status-dot').classList.add('offline');
    }
  };

  await refresh();
  state.timer = setInterval(refresh, 15000);
}

function drawDashboard(dashboard, states, historyPayload) {
  visualSequence = 0;
  const entities = dashboard.entities;
  const history = historyMap(historyPayload);
  const phaseColors = ['#42d3a3', '#56a8ff', '#a98bff'];
  const voltageSeries = entities.phases.map((phase, index) => ({ entity: phase.voltage, label: `Fase ${phase.phase}`, color: phaseColors[index], decimals: 2 }));
  const powerSeries = [
    { entity: entities.power, label: 'Potencia total', color: '#f59e0b', decimals: 2 },
    ...entities.phases.map((phase, index) => ({ entity: phase.power, label: `Fase ${phase.phase}`, color: phaseColors[index], decimals: 2 }))
  ];
  const voltageGauges = entities.phases.map((phase, index) => {
    const reading = value(states[phase.voltage]);
    const normal = reading >= 110 && reading <= 135;
    return gauge({
      title: `Tensao \u00b7 Fase ${phase.phase}`,
      reading,
      unit: 'V',
      min: 100,
      max: 145,
      decimals: 2,
      needleColor: phaseColors[index],
      mode: 'voltage',
      primary: `Fase ${phase.phase}`,
      secondary: normal ? 'Tensao normal' : 'Verificar tensao'
    });
  }).join('');
  const totalPower = value(states[entities.power]);
  const powerMax = 18;
  const powerGauges = [
    gauge({
      title: 'Potencia total',
      reading: totalPower,
      unit: 'kW',
      min: 0,
      max: powerMax,
      decimals: 3,
      needleColor: '#f8fafc',
      primary: 'Consumo instantaneo',
      secondary: `${format((totalPower / powerMax) * 100, 1)}% do limite`
    }),
    ...entities.phases.map((phase, index) => {
      const reading = value(states[phase.power]);
      return gauge({
        title: `Potencia \u00b7 Fase ${phase.phase}`,
        reading,
        unit: 'kW',
        min: 0,
        max: powerMax / 3,
        decimals: 3,
        needleColor: phaseColors[index],
        primary: `Fase ${phase.phase}`,
        secondary: `${format((reading / (powerMax / 3)) * 100, 1)}% do limite`
      });
    })
  ].join('');

  document.querySelector('#live').innerHTML = `
    <section class="dashboard-stack">
      <article class="surface chart-card">
        <h2>Tensao trifasica \u00b7 ${esc(dashboard.name)}</h2>
        ${lineChart(history, voltageSeries, { label: 'Tensao trifasica', unit: 'V', decimals: 1, min: 100, max: 180 })}
      </article>
      <div class="gauge-grid voltage-gauges">${voltageGauges}</div>
      <article class="surface chart-card">
        <h2>Potencia eletrica \u00b7 ${esc(dashboard.name)}</h2>
        ${lineChart(history, powerSeries, { label: 'Potencia eletrica', unit: 'kW', decimals: 1, min: 0, area: true })}
      </article>
      <div class="gauge-grid power-gauges">${powerGauges}</div>
      ${dashboard.circuits?.length ? `<div class="detail-grid">${panelCard(dashboard, states)}${sankeyCard(dashboard, states)}</div>` : ''}
    </section>`;
}

async function renderAdmin() {
  clearInterval(state.timer);
  document.querySelectorAll('.nav-btn').forEach(item => item.classList.remove('active'));
  document.querySelector('[data-admin]').classList.add('active');
  const content = document.querySelector('#content');
  content.innerHTML = '<div class="empty">Carregando acessos...</div>';
  const data = await request('/api/admin/users');
  content.innerHTML = `<header class="topbar"><div><h1>Usuarios e acessos</h1><p>Defina quais setores cada conta pode visualizar</p></div><button class="ghost" id="new-user">+ Novo usuario</button></header><div class="user-list">${data.users.map(user => `<article class="user-row"><div><strong>${esc(user.name)}</strong><small>@${esc(user.username)} \u00b7 ${user.role === 'admin' ? 'Administrador' : 'Visualizador'}</small></div><div class="chips">${user.role === 'admin' ? '<span class="chip">Todos os setores</span>' : user.dashboards.map(id => `<span class="chip">${esc(data.dashboards.find(item => item.id === id)?.name || id)}</span>`).join('') || '<small>Sem setores</small>'}</div>${user.id === state.me.id ? '<span></span>' : `<button class="danger" data-delete="${user.id}">Excluir</button>`}</article>`).join('')}</div>`;
  document.querySelector('#new-user').onclick = () => showUserModal(data.dashboards);
  document.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Excluir este usuario?')) return;
      await request(`/api/admin/users/${button.dataset.delete}`, { method: 'DELETE' });
      toast('Usuario excluido');
      renderAdmin();
    };
  });
}

function showUserModal(dashboards) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<form class="form-card"><h2>Novo usuario</h2><div class="field"><label>Nome</label><input name="name" required></div><div class="field"><label>Usuario</label><input name="username" required></div><div class="field"><label>Senha inicial</label><input name="password" type="password" minlength="10" required></div><div class="field"><label>Setores autorizados</label><div class="checks">${dashboards.map(dashboard => `<label><input type="checkbox" name="dashboards" value="${dashboard.id}"> ${esc(dashboard.name)}</label>`).join('')}</div></div><div class="error"></div><div class="actions"><button type="button" class="ghost" data-cancel>Cancelar</button><button class="primary">Criar usuario</button></div></form>`;
  document.body.append(modal);
  modal.querySelector('[data-cancel]').onclick = () => modal.remove();
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = { name: form.get('name'), username: form.get('username'), password: form.get('password'), dashboards: form.getAll('dashboards') };
    try {
      await request('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      modal.remove();
      toast('Usuario criado');
      renderAdmin();
    } catch (error) {
      modal.querySelector('.error').textContent = error.message;
    }
  };
}

request('/api/setup').then(data => data.needsSetup ? renderLogin(true) : init()).catch(init);
