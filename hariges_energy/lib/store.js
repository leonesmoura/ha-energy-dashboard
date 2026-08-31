import fs from 'node:fs';
import path from 'node:path';
import { DATA_FILE } from './config.js';
import { hashPassword } from './auth.js';

const dashboard = (id, name, prefix, color, circuits = []) => ({
  id, name, color, prefix, circuits,
  entities: {
    energy: `${prefix}_energia`, power: `${prefix}_energia_2`, powerFactor: `${prefix}_fator_de_potencia`,
    frequency: `${prefix}_frequencia`, temperature: `${prefix}_temperatura`, status: `${prefix}_status`,
    phases: ['a', 'b', 'c'].map(phase => ({
      phase: phase.toUpperCase(), voltage: `${prefix}_tensao_${phase}`, current: `${prefix}_corrente_${phase}`,
      power: `${prefix}_potencia_${phase}`, factor: `${prefix}_${phase === 'a' ? 'power_factor_a' : `power_factor_${phase}`}`,
      energy: `${prefix}_energia_consumida_${phase}`
    }))
  }
});

export const defaults = {
  users: [],
  dashboards: [
    dashboard('dti', 'DTI', 'sensor.geral_sala_tecnica_dti', '#42d3a3', ['C1', 'C2', 'C3', 'C4']),
    dashboard('cope', 'COPE', 'sensor.cope_energy_meter', '#56a8ff', ['Ar-condicionado', 'Rack', 'Iluminação']),
    dashboard('emgetis', 'EMGETIS', 'sensor.geral_sala_tecnica_emgetis', '#a98bff', ['C4', 'C5', 'C6'])
  ]
};

export class Store {
  constructor(file = DATA_FILE) { this.file = file; this.data = structuredClone(defaults); }
  load() {
    if (fs.existsSync(this.file)) this.data = { ...structuredClone(defaults), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    this.bootstrap();
    return this;
  }
  bootstrap() {
    if (this.data.users.length) return;
    const username = process.env.APP_ADMIN_USER || 'admin';
    const password = process.env.APP_ADMIN_PASSWORD;
    if (!password) return;
    this.data.users.push({ id: crypto.randomUUID(), username, name: 'Administrador', password: hashPassword(password), role: 'admin', dashboards: this.data.dashboards.map(d => d.id) });
    this.save();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
