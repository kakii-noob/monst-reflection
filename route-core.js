/* Geometry and contact rules shared by the guide, search, and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoutePlannerCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const EPS = 1e-7;
  const DIRECTIONS = 1024;
  const STEP = 360 / DIRECTIONS;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const normalize = degrees => ((degrees % 360) + 360) % 360;
  function snapAngle(degrees) {
    const index = Math.round(normalize(degrees) / STEP) % DIRECTIONS;
    return { index, degrees: index * STEP };
  }
  const insideBoard = (p, b) => p.x >= b.l - EPS && p.x <= b.r + EPS && p.y >= b.t - EPS && p.y <= b.b + EPS;

  // Degrees follow the site's convention: 0 right, 90 up.
  function traceRay({ start, degrees, bounds: b, maxBounces = 6, maxDistance = Infinity }) {
    const result = { points: [{ ...start }], segments: [], distance: 0, valid: false };
    if (!b || ![start.x, start.y, degrees, b.l, b.r, b.t, b.b].every(Number.isFinite) ||
        b.r <= b.l || b.b <= b.t || !insideBoard(start, b) || !(maxDistance > 0)) return result;
    result.valid = true;
    let x = clamp(start.x, b.l, b.r), y = clamp(start.y, b.t, b.b);
    const a = -degrees * Math.PI / 180;
    let dx = Math.cos(a), dy = Math.sin(a);
    maxBounces = clamp(Math.trunc(maxBounces), 0, 20);
    for (let bounce = 0; bounce <= maxBounces; bounce++) {
      const tx = Math.abs(dx) < EPS ? Infinity : ((dx > 0 ? b.r : b.l) - x) / dx;
      const ty = Math.abs(dy) < EPS ? Infinity : ((dy > 0 ? b.b : b.t) - y) / dy;
      const wallDistance = Math.max(0, Math.min(tx, ty));
      const length = Math.min(wallDistance, maxDistance - result.distance);
      const end = { x: clamp(x + dx * length, b.l, b.r), y: clamp(y + dy * length, b.t, b.b) };
      const atWall = wallDistance <= length + EPS;
      const walls = [];
      if (atWall && Math.abs(tx - wallDistance) < EPS) walls.push(dx > 0 ? 'right' : 'left');
      if (atWall && Math.abs(ty - wallDistance) < EPS) walls.push(dy > 0 ? 'bottom' : 'top');
      if (length > EPS) {
        result.segments.push({ start: { x, y }, end, length, distance: result.distance, bouncesBefore: bounce, walls });
        result.points.push(end);
        result.distance += length;
      }
      if (!atWall || result.distance >= maxDistance - EPS || bounce === maxBounces) break;
      if (walls.includes('left') || walls.includes('right')) dx = -dx;
      if (walls.includes('top') || walls.includes('bottom')) dy = -dy;
      x = end.x; y = end.y;
    }
    return result;
  }

  function radii(object, padding = 0) {
    return { rx: (object.rx || object.r || 1) + padding, ry: (object.ry || object.r || 1) + padding };
  }
  function contains(object, point, padding = 0) {
    const { rx, ry } = radii(object, padding);
    return ((point.x - object.x) / rx) ** 2 + ((point.y - object.y) / ry) ** 2 <= 1 + EPS;
  }
  function intersection(object, segment, padding) {
    const { rx, ry } = radii(object, padding);
    const sx = (segment.start.x - object.x) / rx, sy = (segment.start.y - object.y) / ry;
    const vx = (segment.end.x - segment.start.x) / rx, vy = (segment.end.y - segment.start.y) / ry;
    const aa = vx * vx + vy * vy;
    const bb = 2 * (sx * vx + sy * vy), cc = sx * sx + sy * sy - 1;
    const disc = bb * bb - 4 * aa * cc;
    if (aa < EPS * EPS || disc < -EPS) return null;
    const root = Math.sqrt(Math.max(0, disc));
    const lo = (-bb - root) / (2 * aa), hi = (-bb + root) / (2 * aa);
    if (hi < -EPS || lo > 1 + EPS) return null;
    return { enter: clamp(lo, 0, 1), exit: clamp(hi, 0, 1) };
  }

  function contactEvents(trace, objects, padding) {
    const events = [], active = new Set();
    for (const segment of trace.segments) {
      for (const object of objects) {
        const hit = intersection(object, segment, padding);
        if (hit && !(active.has(object.id) && hit.enter <= EPS)) {
          events.push({ type: object.kind, objectId: object.id, object,
            distance: segment.distance + segment.length * hit.enter,
            point: { x: segment.start.x + (segment.end.x - segment.start.x) * hit.enter,
              y: segment.start.y + (segment.end.y - segment.start.y) * hit.enter },
            bounces: segment.bouncesBefore });
        }
        if (contains(object, segment.end, padding)) active.add(object.id);
        else active.delete(object.id);
      }
    }
    // At a coincident boundary, collect a mine before consuming one on a body/weak point.
    const priority = { mine: 0, enemy: 1, weak: 2 };
    events.sort((a, b) => Math.abs(a.distance - b.distance) > EPS ? a.distance - b.distance :
      priority[a.type] - priority[b.type] || String(a.objectId).localeCompare(String(b.objectId)));
    return events;
  }

  function validateScene(scene, options = {}) {
    if (!scene.bounds || !insideBoard(scene.start, scene.bounds)) return '始点を盤面の内側に置いてください。';
    if (!scene.sequence || !scene.sequence.length) return '順番条件を1つ以上追加してください。';
    if (scene.objects.length > 80) return '配置できる対象は80個までです。';
    const ids = new Set(scene.objects.map(o => o.id));
    for (const o of scene.objects) {
      if (!['enemy', 'weak', 'mine'].includes(o.kind) || ![o.x, o.y].every(Number.isFinite)) return '配置データが不正です。';
      const r = radii(o);
      if (![r.rx, r.ry].every(n => Number.isFinite(n) && n > 0)) return '判定の半径を正の数にしてください。';
      if (o.kind === 'weak' && o.parentId && !scene.objects.some(p => p.id === o.parentId && p.kind === 'enemy')) {
        return '弱点の所属する敵を選び直してください。';
      }
    }
    for (const step of scene.sequence) {
      const o = scene.objects.find(o => o.id === step.objectId);
      if (!ids.has(step.objectId) || !o || o.kind === 'mine') return '順番条件の対象を選び直してください。';
      if (o.avoid || (o.parentId && scene.objects.find(p => p.id === o.parentId)?.avoid)) return '避ける敵を順番条件には指定できません。';
    }
    if (options.maxDistance !== undefined && !(options.maxDistance > 0)) return '探索距離を正の数にしてください。';
    return '';
  }

  function analyseRoute(scene, degrees, options = {}) {
    const trace = traceRay({ start: scene.start, degrees, bounds: scene.bounds,
      maxBounces: options.maxBounces ?? 6, maxDistance: options.maxDistance ?? Infinity });
    const output = { success: false, reason: '順番条件を最後まで達成できません。', trace,
      events: [], stepsDone: 0, distance: trace.distance, bounces: 0, mines: clamp(options.initialMines || 0, 0, 4) };
    if (!trace.valid) { output.reason = '始点・盤面・距離の設定を確認してください。'; return output; }
    const picked = new Set(), objectsById = new Map(scene.objects.map(o => [o.id, o]));
    for (const e of contactEvents(trace, scene.objects, Math.max(0, options.playerRadius || 0))) {
      const before = output.mines;
      if (e.type === 'mine') {
        if (picked.has(e.objectId) || before >= 4) continue;
        output.mines++; picked.add(e.objectId);
      } else if (output.mines > 0) output.mines--;
      const event = { ...e, minesBefore: before, minesAfter: output.mines, step: null };
      output.events.push(event);
      const parent = objectsById.get(e.object.parentId);
      if (e.object.avoid || parent?.avoid) {
        output.reason = `${e.object.label || '対象'}に接触します。`;
        output.distance = e.distance;
        return output;
      }
      const next = scene.sequence[output.stepsDone];
      if (next && next.objectId === e.objectId && before >= (next.minMines || 0)) {
        event.step = ++output.stepsDone;
        if (output.stepsDone === scene.sequence.length) {
          output.success = true; output.reason = '';
          output.distance = e.distance; output.bounces = e.bounces;
          return output;
        }
      }
    }
    return output;
  }

  function perturbations(scene, options) {
    const t = Math.max(0, options.startTolerance ?? 2);
    const offsets = t ? [[0, 0], [-t, 0], [t, 0], [0, -t], [0, t], [-t, -t], [-t, t], [t, -t], [t, t]] : [[0, 0]];
    const a = clamp(Math.trunc(options.angleTolerance ?? 1), 0, 3);
    const samples = [];
    for (let step = -a; step <= a; step++) for (const [x, y] of offsets) {
      samples.push({ step, start: { x: scene.start.x + x, y: scene.start.y + y } });
    }
    return samples;
  }

  // The generator yields progress so the UI can remain responsive and cancel a search.
  function* searchRoutes(scene, options = {}) {
    const error = validateScene(scene, options);
    if (error) throw new Error(error);
    const candidates = [];
    for (let index = 0; index < DIRECTIONS; index++) {
      const route = analyseRoute(scene, index * STEP, options);
      if (route.success) candidates.push({ index, degrees: index * STEP, ...route });
      if ((index + 1) % 32 === 0) yield { phase: 'angles', done: index + 1, total: DIRECTIONS };
    }
    const samples = perturbations(scene, options);
    for (let i = 0; i < candidates.length; i++) {
      const route = candidates[i];
      let passed = 0;
      for (const sample of samples) {
        if (!sample.step && sample.start.x === scene.start.x && sample.start.y === scene.start.y) { passed++; continue; }
        if (analyseRoute({ ...scene, start: sample.start }, normalize(route.degrees + sample.step * STEP), options).success) passed++;
      }
      route.robustness = { passed, total: samples.length, ratio: passed / samples.length };
      if ((i + 1) % 8 === 0) yield { phase: 'tolerance', done: i + 1, total: candidates.length };
    }
    candidates.sort((a, b) => b.robustness.ratio - a.robustness.ratio || a.distance - b.distance || a.bounces - b.bounces || a.index - b.index);
    const chosen = [], separation = options.separation ?? 2;
    for (const c of candidates) {
      if (chosen.some(o => Math.min(Math.abs(o.index - c.index), DIRECTIONS - Math.abs(o.index - c.index)) <= separation)) continue;
      chosen.push(c);
      if (chosen.length >= (options.maxResults || 8)) break;
    }
    return { routes: chosen, validDirections: candidates.length, testedDirections: DIRECTIONS, samples: samples.length };
  }
  function findRoutes(scene, options) {
    const search = searchRoutes(scene, options);
    let step;
    do { step = search.next(); } while (!step.done);
    return step.value;
  }
  return { DIRECTIONS, STEP, normalize, snapAngle, traceRay, contains, contactEvents, validateScene, analyseRoute, searchRoutes, findRoutes };
});
