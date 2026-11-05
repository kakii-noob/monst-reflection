const assert = require('node:assert/strict');
const { test } = require('node:test');
const core = require('../route-core.js');
const board = { l: 0, t: 0, r: 100, b: 100 };
const enemy = (id, x, y, rx = 5, ry = rx) => ({ id, label: id, kind: 'enemy', x, y, rx, ry });
const mine = (id, x, y) => ({ id, label: id, kind: 'mine', x, y, rx: 2, ry: 2 });
function bookScene() {
  return {
    bounds: board, start: { x: 10, y: 50 },
    objects: [enemy('boss', 30, 50), mine('m1', 45, 50), mine('m2', 60, 50), enemy('book', 80, 50, 10),
      { id: 'weak', label: 'weak', kind: 'weak', parentId: 'book', x: 80, y: 50, rx: 2, ry: 2 }],
    sequence: [{ objectId: 'boss', minMines: 0 }, { objectId: 'book', minMines: 2 }, { objectId: 'weak', minMines: 1 }],
  };
}
const options = { maxBounces: 0, maxDistance: 100, playerRadius: 0, initialMines: 0 };

test('1024 directions snap to exact multiples and wrap consistently', () => {
  assert.equal(core.STEP, 0.3515625);
  assert.deepEqual(core.snapAngle(151.4), { index: 431, degrees: 151.5234375 });
  assert.equal(core.snapAngle(359.99).index, 0);
  assert.equal(core.snapAngle(-0.01).index, 0);
  for (let i = 0; i < 1024; i++) assert.equal(core.snapAngle(i * core.STEP).index, i);
});

test('the guide and solver trace all four exact corners and near-corner double hits', () => {
  for (const degrees of [45, 135, 225, 315, 44.9999, 45.0001, 0, 90]) {
    const route = core.traceRay({ start: { x: 50, y: 50 }, degrees, bounds: board, maxBounces: 20 });
    assert.equal(route.points.length, 22);
    for (const p of route.points) assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100);
  }
});

test('distance limit clips the last segment and invalid starts are rejected', () => {
  const route = core.traceRay({ start: { x: 10, y: 50 }, degrees: 0, bounds: board, maxDistance: 30 });
  assert.equal(route.distance, 30);
  assert.deepEqual(route.points.at(-1), { x: 40, y: 50 });
  assert.equal(core.traceRay({ start: { x: -1, y: 50 }, degrees: 0, bounds: board }).valid, false);
});

test('boss, two pickups, book body, then internal weak point consume two distinct mines', () => {
  const result = core.analyseRoute(bookScene(), 0, options);
  assert.equal(result.success, true);
  assert.equal(result.stepsDone, 3);
  assert.deepEqual(result.events.map(e => [e.objectId, e.minesBefore, e.minesAfter]), [
    ['boss', 0, 0], ['m1', 0, 1], ['m2', 1, 2], ['book', 2, 1], ['weak', 1, 0],
  ]);
  assert.ok(Math.abs(result.distance - 68) < 1e-7);
});

test('one mine or an extra body contact is insufficient for the two-mine entry condition', () => {
  const missing = bookScene(); missing.objects = missing.objects.filter(o => o.id !== 'm2');
  assert.equal(core.analyseRoute(missing, 0, options).success, false);
  const wasted = bookScene(); wasted.objects.push(enemy('extra', 66, 50, 1));
  assert.equal(core.analyseRoute(wasted, 0, options).success, false);
});

test('avoidance applies until the last goal, including the parent of a weak point', () => {
  const scene = bookScene(); scene.objects.push({ ...enemy('eye', 52, 50, 2), avoid: true });
  const avoided = core.analyseRoute(scene, 0, options);
  assert.equal(avoided.success, false);
  assert.match(avoided.reason, /eye/);
  scene.objects.at(-1).x = 95;
  assert.equal(core.analyseRoute(scene, 0, options).success, true);
  scene.objects.find(o => o.id === 'book').avoid = true;
  assert.match(core.validateScene(scene, options), /避ける/);
});

test('reverse encounter order does not fulfil an ordered goal sequence', () => {
  const scene = { bounds: board, start: { x: 10, y: 50 }, objects: [enemy('a', 30, 50), enemy('b', 70, 50)],
    sequence: [{ objectId: 'b' }, { objectId: 'a' }] };
  assert.equal(core.analyseRoute(scene, 0, options).success, false);
  assert.equal(core.analyseRoute(scene, 0, { ...options, maxBounces: 1, maxDistance: 200 }).success, true);
});

test('a mine is collected once per shot and a body is not hit again while continuously inside it', () => {
  const scene = { bounds: board, start: { x: 10, y: 50 }, objects: [mine('m', 50, 50), enemy('body', 99, 50, 10)], sequence: [] };
  const result = core.analyseRoute(scene, 0, { ...options, maxBounces: 3, maxDistance: 400 });
  assert.equal(result.events.filter(e => e.objectId === 'm').length, 1);
  // Right-wall reflections occur inside the body; those are not fresh entries.
  assert.equal(result.events.filter(e => e.objectId === 'body').length, 2);
});

test('a full inventory leaves a mine available for a later pass after consumption', () => {
  const scene = { bounds: board, start: { x: 10, y: 50 }, objects: [mine('m', 50, 50), enemy('body', 80, 50)], sequence: [] };
  const result = core.analyseRoute(scene, 0, { ...options, initialMines: 4, maxBounces: 1, maxDistance: 180 });
  const pickup = result.events.find(e => e.objectId === 'm');
  assert.ok(pickup.distance > 90);
  assert.equal(pickup.minesBefore, 2);
  assert.equal(pickup.minesAfter, 3);
});

test('all 1024 directions are searched and results use exact direction indices', () => {
  const scene = bookScene();
  const result = core.findRoutes(scene, { ...options, startTolerance: 0, angleTolerance: 0 });
  assert.equal(result.testedDirections, 1024);
  assert.ok(result.validDirections > 0);
  assert.equal(result.routes[0].index, 0);
  for (const route of result.routes) {
    assert.equal(route.degrees, route.index * core.STEP);
    assert.equal(route.robustness.ratio, 1);
    assert.equal(core.analyseRoute(scene, route.degrees, options).success, true);
  }
});

test('robustness tests the cross product of adjacent directions and nine start positions', () => {
  const scene = { bounds: board, start: { x: 10, y: 50 }, objects: [enemy('goal', 80, 50, 8)], sequence: [{ objectId: 'goal' }] };
  const broad = core.findRoutes(scene, { ...options, angleTolerance: 1, startTolerance: 2 });
  assert.equal(broad.samples, 27);
  assert.equal(broad.routes[0].robustness.passed, 27);
  scene.objects[0].rx = scene.objects[0].ry = 0.1;
  const narrow = core.findRoutes(scene, { ...options, angleTolerance: 1, startTolerance: 2 });
  // The three horizontal starts (x-2, x, x+2) all still hit the tiny target.
  assert.equal(narrow.routes[0].robustness.passed, 3);
  assert.equal(narrow.routes[0].robustness.total, 27);
});

test('missing goals produce no candidates and missing/deleted objects are validated', () => {
  const scene = bookScene(); scene.sequence = [{ objectId: 'deleted' }];
  assert.match(core.validateScene(scene, options), /選び直/);
  assert.throws(() => core.findRoutes(scene, options), /選び直/);
  scene.sequence = [{ objectId: 'boss', minMines: 4 }];
  const result = core.findRoutes(scene, { ...options, maxBounces: 0 });
  assert.equal(result.routes.length, 0);
});

test('search progress is incremental, allowing the UI to cancel between batches', () => {
  const search = core.searchRoutes(bookScene(), options);
  assert.deepEqual(search.next().value, { phase: 'angles', done: 32, total: 1024 });
  assert.equal(search.return().done, true);
});
