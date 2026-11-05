const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function setup() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window, $ = id => w.document.getElementById(id);
  const context = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} });
  w.HTMLCanvasElement.prototype.getContext = () => context;
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  $('cv').getBoundingClientRect = () => ({ left: 0, top: 0, width: 706, height: 1536 });
  $('stage').getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
  Object.defineProperties($('wrap'), { clientWidth: { value: 390 }, clientHeight: { value: 844 } });
  Object.defineProperties($('photo'), { naturalWidth: { value: 706 }, naturalHeight: { value: 1536 } });
  w.URL.createObjectURL = () => 'blob:fixture';
  w.requestAnimationFrame = () => {};
  w.TextEncoder = TextEncoder;
  w.alert = message => { throw new Error(message); };
  const scope = dom.getInternalVMContext();
  // Separate classic scripts share global lexical bindings, unlike separate eval calls.
  vm.runInContext(fs.readFileSync(path.join(root, 'route-core.js'), 'utf8'), scope);
  vm.runInContext(inline, scope);
  vm.runInContext(fs.readFileSync(path.join(root, 'planner-ui.js'), 'utf8'), scope);
  function event(id, type) { $(id).dispatchEvent(new w.Event(type, { bubbles: true })); }
  function value(id, text) { $(id).value = String(text); event(id, 'input'); event(id, 'change'); }
  function tap(x, y) {
    for (const type of ['pointerdown', 'pointerup']) $('cv').dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  }
  function tool(name) {
    if ($('plannerPanel').hidden) $('plannerToggle').click();
    w.document.querySelector(`[data-tool="${name}"]`).click();
  }
  function loadImage() { $('file').onchange({ target: { files: [{}] } }); $('photo').onload(); }
  return { dom, w, $, event, value, tap, tool, loadImage };
}

test('page loads, angle mode snaps numeric input, and one step changes one direction', () => {
  const app = setup(), { $, w } = app;
  try {
    $('angleDisplay').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    let input = w.document.querySelector('[aria-label="角度を入力"]');
    input.value = '151.4'; input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal($('angleDisplay').querySelector('.angleValue').textContent, '151.5234°');
    assert.match($('directionIndex').textContent, /#431/);
    for (const type of ['pointerdown', 'pointerup']) $('anglePlus').dispatchEvent(new w.MouseEvent(type, { bubbles: true }));
    assert.match($('directionIndex').textContent, /#432/);
    app.value('angleMode', 'free');
    $('angleDisplay').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    input = w.document.querySelector('[aria-label="角度を入力"]');
    input.value = '151.4'; input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal($('angleDisplay').querySelector('.angleValue').textContent, '151.40°');
  } finally { app.dom.window.close(); }
});

test('image, manual placements, book preset, search, candidate selection, and invalidation work together', async () => {
  const app = setup(), { $, w } = app;
  try {
    app.loadImage();
    app.tool('start'); app.tap(100, 600);
    app.tool('boss'); app.tap(200, 600); $('placementDone').click();
    app.value('objectRx', 30); app.value('objectRy', 30);
    app.tool('book'); app.tap(550, 600); $('placementDone').click();
    app.tool('mine'); app.tap(330, 600); app.tap(430, 600); $('placementDone').click();
    assert.equal($('objectList').querySelectorAll('button').length, 5);
    $('bookPreset').click();
    assert.equal($('conditionList').querySelectorAll('li').length, 3);
    app.value('playerRadius', 0); app.value('searchBounces', 2);
    await $('searchRoutes').onclick();
    assert.match($('searchStatus').textContent, /成立する方向/);
    assert.ok($('routeResults').querySelectorAll('button').length > 0);
    assert.equal($('angleDisplay').querySelector('.angleValue').textContent, '0.0000°');
    assert.equal($('n').querySelector('.num').textContent, '0');
    assert.match($('contactLog').textContent, /地雷 2 → 1/);
    assert.match($('contactLog').textContent, /地雷 1 → 0/);
    assert.ok($('routeResults').querySelector('[aria-pressed="true"]'));
    // Moving the original shot marker must discard scores computed for its old start.
    const arm = { x: 100 + 125 * Math.SQRT1_2, y: 600 + 125 * Math.SQRT1_2 };
    $('cv').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: arm.x, clientY: arm.y }));
    $('cv').dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: arm.x + 1, clientY: arm.y }));
    $('cv').dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: arm.x + 1, clientY: arm.y }));
    assert.equal($('routeResults').children.length, 0);
    assert.match($('searchStatus').textContent, /始点が変わりました/);
    // Put a forbidden enemy across the direct mine corridor: no unreflected route can pass it.
    app.value('searchBounces', 0);
    app.tool('enemy'); app.tap(380, 600); $('placementDone').click();
    $('objectAvoid').checked = true; app.event('objectAvoid', 'change');
    assert.equal($('routeResults').children.length, 0);
    await $('searchRoutes').onclick();
    assert.match($('searchStatus').textContent, /方向がありません/);
    assert.equal($('searchRoutes').disabled, false);
    assert.equal($('cancelSearch').disabled, true);
  } finally { w.close(); }
});

test('search can be cancelled and changing the image clears stale targets and goals', async () => {
  const app = setup(), { $ } = app;
  try {
    app.loadImage(); app.tool('boss'); app.tap(350, 600); $('placementDone').click();
    $('addCondition').click();
    const pending = $('searchRoutes').onclick();
    $('cancelSearch').click();
    await pending;
    assert.match($('searchStatus').textContent, /中止/);
    assert.equal($('routeResults').children.length, 0);
    app.loadImage();
    assert.equal($('objectList').querySelectorAll('button').length, 0);
    assert.match($('conditionList').textContent, /順番条件に追加/);
  } finally { app.dom.window.close(); }
});
