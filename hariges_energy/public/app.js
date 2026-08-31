const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const state = { me: null, dashboards: [], active: null, timer: null };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Falha na solicitação'), { status: response.status });
  return data;
}
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), 2500); }
function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function number(item, decimals = 2) { const n = Number(item?.value); return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—'; }
function metric(label, item, decimals = 2) { return `<article class="card metric"><div class="label">${label}</div><div class="value">${number(item, decimals)}<span class="unit">${esc(item?.unit)}</span></div></article>`; }

async function init() {
  try {
    const data = await request('/api/me'); state.me = data.user; state.dashboards = data.dashboards; state.active = data.dashboards[0]?.id; renderShell();
  } catch (error) { if (error.status === 401) renderLogin(); else toast(error.message); }
}
function renderLogin(setup = false) {
  clearInterval(state.timer);
  app.innerHTML = `<section class="login-shell"><div class="login-brand"><div class="brand"><span class="brand-mark">ϟ</span> HARIGES</div><div class="login-copy"><div class="eyebrow">Inteligência energética</div><h1>Energia visível.<br>Decisões melhores.</h1><p>Acompanhe consumo, potência e qualidade elétrica de cada setor em tempo real.</p></div><small style="color:var(--muted)">Monitoramento integrado ao Home Assistant</small></div><div class="login-panel"><form class="form-card" id="login-form"><div class="eyebrow">Acesso seguro</div><h2>${setup ? 'Primeiro acesso' : 'Bem-vindo'}</h2><p>${setup ? 'Crie a conta administradora.' : 'Entre com as credenciais do seu setor.'}</p>${setup ? '<div class="field"><label>Nome</label><input name="name" autocomplete="name" required></div>' : ''}<div class="field"><label>Usuário</label><input name="username" autocomplete="username" required autofocus></div><div class="field"><label>Senha</label><input type="password" name="password" autocomplete="current-password" minlength="10" required></div><div class="error" id="form-error"></div><button class="primary" type="submit">${setup ? 'Criar administrador' : 'Entrar no painel'}</button></form></div></section>`;
  document.querySelector('#login-form').onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; const body = Object.fromEntries(new FormData(event.target)); try { if (setup) { await request('/api/setup', { method: 'POST', body: JSON.stringify(body) }); toast('Administrador criado'); renderLogin(); } else { await request('/api/login', { method: 'POST', body: JSON.stringify(body) }); await init(); } } catch (e) { document.querySelector('#form-error').textContent = e.message; } finally { button.disabled = false; } };
}
function renderShell() {
  const nav = state.dashboards.map(d => `<button class="nav-btn ${d.id === state.active ? 'active' : ''}" data-dash="${d.id}"><span style="color:${d.color}">●</span> ${esc(d.name)}</button>`).join('');
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">ϟ</span> HARIGES</div><nav class="side-nav">${nav}${state.me.role === 'admin' ? '<button class="nav-btn" data-admin>⚙ <span>Acessos</span></button>' : ''}</nav><div class="side-user"><strong>${esc(state.me.name)}</strong><small>${state.me.role === 'admin' ? 'Administrador' : 'Visualizador'}</small><button class="nav-btn" data-logout>Sair</button></div></aside><section class="content" id="content"></section></div>`;
  document.querySelectorAll('[data-dash]').forEach(button => button.onclick = () => { state.active = button.dataset.dash; renderShell(); });
  document.querySelector('[data-admin]')?.addEventListener('click', renderAdmin);
  document.querySelector('[data-logout]')?.addEventListener('click', async () => { await request('/api/logout', { method: 'POST' }); renderLogin(); });
  renderDashboard();
}
async function renderDashboard() {
  clearInterval(state.timer); const dashboard = state.dashboards.find(d => d.id === state.active); const content = document.querySelector('#content');
  if (!dashboard) { content.innerHTML = '<div class="empty">Nenhum setor foi liberado para este usuário.</div>'; return; }
  content.innerHTML = `<header class="topbar"><div><h1>${esc(dashboard.name)}</h1><p>Visão geral do consumo e qualidade elétrica</p></div><div class="status"><i class="status-dot"></i><span id="updated">Conectando…</span></div></header><div id="live"><div class="empty">Carregando medições…</div></div>`;
  const refresh = async () => { try { const [{ states, timestamp }, historyData] = await Promise.all([request(`/api/dashboards/${dashboard.id}/live`), request(`/api/dashboards/${dashboard.id}/history?hours=24`).catch(() => ({ history: [] }))]); drawDashboard(dashboard, states, historyData.history); document.querySelector('#updated').textContent = `Atualizado ${new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; } catch (e) { document.querySelector('#updated').textContent = e.message; document.querySelector('.status-dot').style.background = 'var(--danger)'; } };
  await refresh(); state.timer = setInterval(refresh, 15000);
}
function chart(history) {
  const entries = (history?.[0] || []).map(x => ({ y: Number(x.state), t: new Date(x.last_changed).getTime() })).filter(x => Number.isFinite(x.y) && Number.isFinite(x.t));
  if (entries.length < 2) return '<div class="empty">Histórico ainda não disponível</div>';
  const w = 800, h = 230, pad = 16, minY = Math.min(...entries.map(x => x.y)), maxY = Math.max(...entries.map(x => x.y)), minT = entries[0].t, maxT = entries.at(-1).t;
  const points = entries.map(x => `${pad + (x.t - minT) / Math.max(1, maxT - minT) * (w - pad * 2)},${h - pad - (x.y - minY) / Math.max(.001, maxY - minY) * (h - pad * 2)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${[.25,.5,.75].map(v => `<line class="grid" x1="0" x2="${w}" y1="${h*v}" y2="${h*v}"/>`).join('')}<polygon class="area" points="${pad},${h} ${points} ${w-pad},${h}"/><polyline class="line" points="${points}"/></svg>`;
}
function drawDashboard(d, s, history) {
  const e = d.entities; const phases = e.phases.map(p => `<div class="phase"><span class="phase-name">${p.phase}</span><div><b>${number(s[p.voltage],1)} V</b><small>Tensão</small></div><div><b>${number(s[p.current],2)} A</b><small>Corrente</small></div><div><b>${number(s[p.power],3)} kW</b><small>Potência</small></div></div>`).join('');
  document.querySelector('#live').innerHTML = `<div style="--accent:${d.color}"><div class="metrics">${metric('Potência agora',s[e.power],3)}${metric('Energia acumulada',s[e.energy],2)}${metric('Fator de potência',s[e.powerFactor],2)}${metric('Frequência',s[e.frequency],1)}</div><div class="grid-2"><article class="card"><h3>Potência nas últimas 24 horas</h3>${chart(history)}</article><article class="card"><h3>Equilíbrio entre fases</h3><div class="phases">${phases}</div></article></div></div>`;
}
async function renderAdmin() {
  clearInterval(state.timer); document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active')); document.querySelector('[data-admin]').classList.add('active');
  const content = document.querySelector('#content'); content.innerHTML = '<div class="empty">Carregando acessos…</div>';
  const data = await request('/api/admin/users');
  content.innerHTML = `<header class="topbar"><div><h1>Usuários e acessos</h1><p>Defina quais setores cada conta pode visualizar</p></div><button class="ghost" id="new-user">+ Novo usuário</button></header><div class="user-list">${data.users.map(u => `<article class="user-row"><div><strong>${esc(u.name)}</strong><small style="display:block;color:var(--muted)">@${esc(u.username)} · ${u.role === 'admin' ? 'Administrador' : 'Visualizador'}</small></div><div class="chips">${u.role === 'admin' ? '<span class="chip">Todos os setores</span>' : u.dashboards.map(id => `<span class="chip">${esc(data.dashboards.find(d => d.id === id)?.name || id)}</span>`).join('') || '<small>Sem setores</small>'}</div>${u.id === state.me.id ? '<span></span>' : `<button class="danger" data-delete="${u.id}">Excluir</button>`}</article>`).join('')}</div>`;
  document.querySelector('#new-user').onclick = () => showUserModal(data.dashboards);
  document.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => { if (!confirm('Excluir este usuário?')) return; await request(`/api/admin/users/${btn.dataset.delete}`, { method: 'DELETE' }); toast('Usuário excluído'); renderAdmin(); });
}
function showUserModal(dashboards) {
  const modal = document.createElement('div'); modal.className = 'modal'; modal.innerHTML = `<form class="form-card"><h2>Novo usuário</h2><div class="field"><label>Nome</label><input name="name" required></div><div class="field"><label>Usuário</label><input name="username" required></div><div class="field"><label>Senha inicial</label><input name="password" type="password" minlength="10" required></div><div class="field"><label>Setores autorizados</label><div class="checks">${dashboards.map(d => `<label><input type="checkbox" name="dashboards" value="${d.id}"> ${esc(d.name)}</label>`).join('')}</div></div><div class="error"></div><div class="actions"><button type="button" class="ghost" data-cancel>Cancelar</button><button class="primary">Criar usuário</button></div></form>`; document.body.append(modal);
  modal.querySelector('[data-cancel]').onclick = () => modal.remove(); modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.querySelector('form').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const body = { name: fd.get('name'), username: fd.get('username'), password: fd.get('password'), dashboards: fd.getAll('dashboards') }; try { await request('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }); modal.remove(); toast('Usuário criado'); renderAdmin(); } catch (error) { modal.querySelector('.error').textContent = error.message; } };
}

request('/api/setup').then(data => data.needsSetup ? renderLogin(true) : init()).catch(init);
