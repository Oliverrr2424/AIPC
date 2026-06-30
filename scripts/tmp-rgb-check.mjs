const post = (body) => fetch('http://localhost:3000/api/rag/recommend', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

const row = (b) => ({
  gpu: b.parts.gpu.chipset,
  gpuPrice: Math.round(b.parts.gpu.price),
  gpuRgb: b.parts.gpu.tags.includes('rgb'),
  ram: b.parts.ram.capacityGb,
  ramRgb: b.parts.ram.tags.includes('rgb'),
  ramName: b.parts.ram.name.slice(0, 44),
  ssd: b.parts.storage.capacityTb,
});

const ai = { model: 'deepseek-v4-flash', thinking: 'disabled' };
const base = await post({ query: 'USD 2200，主要玩 1440p 144Hz 游戏，希望安静、方便以后升级，不要 RGB。', ...ai });
const rgb = await post({ query: '改成需要 rgb的版本', currentBuild: base, ...ai });
const part = await post({ query: '把ram和gpu也要有灯光', currentBuild: rgb, ...ai });

console.log(JSON.stringify({
  baseline: row(base),
  afterRgb: row(rgb),
  afterRamGpu: row(part),
  action: part.interaction?.action,
  affected: part.interaction?.affectedCategories,
  changed: part.interaction?.changedParts?.map(c => `${c.category}${c.inducedByCompatibility ? '(compat)' : ''}`),
  baseRamCap: base.request.ramCapacityGb,
  rgbRamCap: rgb.request.ramCapacityGb,
  partRamCap: part.request.ramCapacityGb,
  reason: part.interaction?.message,
}, null, 2));
