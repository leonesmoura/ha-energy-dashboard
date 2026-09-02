import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../hariges_energy/public/app.js', import.meta.url), 'utf8');
const context = { document: { querySelector: () => ({}) } };
runInNewContext(source.slice(0, source.indexOf('function panelCard(')), context);

for (const reading of [0, 0.745, 9, 18]) {
  test('gauge readout stays outside needle SVG at ' + reading, () => {
    const html = context.gauge({
      title: 'Power', reading, unit: 'kW', min: 0, max: 18,
      decimals: 3, needleColor: '#fff', primary: 'Phase A', secondary: 'Load'
    });
    const svg = html.match(/<svg[\s\S]*?<\/svg>/)[0];
    assert.doesNotMatch(svg, /gauge-value|gauge-primary|gauge-secondary/);
    assert.match(html, /<\/svg>\s*<div class="gauge-readout">/);
    assert.ok(html.includes(reading.toLocaleString('pt-BR', {
      minimumFractionDigits: 3, maximumFractionDigits: 3
    }) + ' kW'));
  });
}
