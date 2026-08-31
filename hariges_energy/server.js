import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, PUBLIC_DIR } from './lib/config.js';
import { Store } from './lib/store.js';
import { HomeAssistant } from './lib/ha.js';
import { hashPassword, parseCookies, token, verifyPassword } from './lib/auth.js';

loadEnv();
const store = new Store().load();
const ha = new HomeAssistant(process.env.HA_URL || 'http://supervisor/core', process.env.HA_TOKEN || process.env.SUPERVISOR_TOKEN);
const sessions = new Map();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const cookieSecure = process.env.COOKIE_SECURE === 'true';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const send = (res, status, data, headers = {}) => {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const readBody = async req => {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) throw Object.assign(new Error('Requisição muito grande'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
};
const currentUser = req => {
  const sid = parseCookies(req.headers.cookie).hariges_session;
  const session = sessions.get(sid);
  if (!session || session.expires < Date.now()) { if (sid) sessions.delete(sid); return null; }
  return store.data.users.find(u => u.id === session.userId) || null;
};
const publicUser = user => ({ id: user.id, username: user.username, name: user.name, role: user.role, dashboards: user.dashboards });
const allowedDashboards = user => store.data.dashboards.filter(d => user.role === 'admin' || user.dashboards.includes(d.id));
const entityIds = dashboard => {
  const e = dashboard.entities;
  return [e.energy, e.power, e.powerFactor, e.frequency, e.temperature, e.status, ...e.phases.flatMap(p => [p.voltage, p.current, p.power, p.factor, p.energy])];
};

async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req);
    const user = store.data.users.find(u => u.username.toLowerCase() === String(body.username || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(body.password || ''), user.password)) return send(res, 401, { error: 'Usuário ou senha inválidos' });
    const sid = token();
    sessions.set(sid, { userId: user.id, expires: Date.now() + 12 * 3600000 });
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': `hariges_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${cookieSecure ? '; Secure' : ''}` });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const sid = parseCookies(req.headers.cookie).hariges_session;
    if (sid) sessions.delete(sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'hariges_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET' && url.pathname === '/api/setup') return send(res, 200, { needsSetup: store.data.users.length === 0, haConfigured: ha.configured });
  if (req.method === 'POST' && url.pathname === '/api/setup' && store.data.users.length === 0) {
    const body = await readBody(req);
    if (String(body.password || '').length < 10 || !String(body.username || '').trim()) return send(res, 400, { error: 'Informe usuário e uma senha com ao menos 10 caracteres' });
    const user = { id: crypto.randomUUID(), username: String(body.username).trim(), name: String(body.name || body.username).trim(), password: hashPassword(String(body.password)), role: 'admin', dashboards: store.data.dashboards.map(d => d.id) };
    store.data.users.push(user); store.save();
    return send(res, 201, { ok: true });
  }

  const user = currentUser(req);
  if (!user) return send(res, 401, { error: 'Sessão expirada' });
  if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user: publicUser(user), dashboards: allowedDashboards(user), haConfigured: ha.configured });
  const dashboardMatch = url.pathname.match(/^\/api\/dashboards\/([^/]+)\/(live|history)$/);
  if (req.method === 'GET' && dashboardMatch) {
    const dashboard = allowedDashboards(user).find(d => d.id === dashboardMatch[1]);
    if (!dashboard) return send(res, 403, { error: 'Setor não autorizado' });
    if (dashboardMatch[2] === 'live') return send(res, 200, { states: await ha.states(entityIds(dashboard)), timestamp: new Date().toISOString() });
    return send(res, 200, { history: await ha.history([dashboard.entities.power], Number(url.searchParams.get('hours') || 24)) });
  }
  if (user.role !== 'admin') return send(res, 403, { error: 'Acesso restrito ao administrador' });
  if (req.method === 'GET' && url.pathname === '/api/admin/users') return send(res, 200, { users: store.data.users.map(publicUser), dashboards: store.data.dashboards.map(({ id, name, color }) => ({ id, name, color })) });
  if (req.method === 'POST' && url.pathname === '/api/admin/users') {
    const body = await readBody(req); const username = String(body.username || '').trim(); const password = String(body.password || '');
    if (!username || password.length < 10) return send(res, 400, { error: 'Informe usuário e senha com ao menos 10 caracteres' });
    if (store.data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return send(res, 409, { error: 'Usuário já existe' });
    const dashboards = store.data.dashboards.map(d => d.id).filter(id => body.dashboards?.includes(id));
    store.data.users.push({ id: crypto.randomUUID(), username, name: String(body.name || username).trim(), password: hashPassword(password), role: body.role === 'admin' ? 'admin' : 'viewer', dashboards }); store.save();
    return send(res, 201, { ok: true });
  }
  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === 'PATCH' && userMatch) {
    const target = store.data.users.find(u => u.id === userMatch[1]); if (!target) return send(res, 404, { error: 'Usuário não encontrado' });
    const body = await readBody(req);
    if (body.name !== undefined) target.name = String(body.name).trim();
    if (body.password) { if (String(body.password).length < 10) return send(res, 400, { error: 'Senha deve ter ao menos 10 caracteres' }); target.password = hashPassword(String(body.password)); }
    if (Array.isArray(body.dashboards)) target.dashboards = store.data.dashboards.map(d => d.id).filter(id => body.dashboards.includes(id));
    store.save(); return send(res, 200, { user: publicUser(target) });
  }
  if (req.method === 'DELETE' && userMatch) {
    if (userMatch[1] === user.id) return send(res, 400, { error: 'Você não pode excluir o próprio usuário' });
    store.data.users = store.data.users.filter(u => u.id !== userMatch[1]); store.save(); return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Rota não encontrada' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Não encontrado');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(file).pipe(res);
  } catch (error) { console.error(error); send(res, error.status || 500, { error: error.status ? error.message : 'Erro interno do servidor' }); }
});

server.listen(port, host, () => console.log(`HARiges disponível em http://${host}:${port}`));
