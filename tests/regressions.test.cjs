const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(process.env.MONST_TEST_HTML || path.join(__dirname, '../index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

// Run the complete application script with a small DOM/canvas substitute.
// No browser, network, packages, or changes to the production HTML are required.
function loadApp() {
  const elements = new Map();
  const windowEvents = new Map();
  const downloads = [];
  const blobs = new Map();
  let draws = 0;
  const context = new Proxy({}, { get: (_, name) => name === 'createRadialGradient'
    ? () => ({ addColorStop() {} })
    : () => { if (name === 'clearRect') draws++; } });
  function element(id = '') {
    return {
      id, hidden: id === 'stage', value: '', style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {} }, events: new Map(),
      clientWidth: 390, clientHeight: 844, offsetHeight: 190,
      naturalWidth: 706, naturalHeight: 1536,
      addEventListener(name, callback) { this.events.set(name, callback); },
      querySelector(selector) { return get(`${id}:${selector}`); },
      getContext() { return context; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 390, height: 844 }; },
      click() { if (this.download) downloads.push(this); }, remove() {},
    };
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  }
  const modes = ['rapid', 'gauge'].map(value => ({ ...element(), value, checked: value === 'rapid' }));
  const document = {
    getElementById: get, createElement: () => element(), addEventListener() {},
    querySelectorAll: () => modes, documentElement: element(), body: { appendChild() {} },
  };
  const window = {
    innerHeight: 844, screen: { width: 390, height: 844 }, devicePixelRatio: 3,
    addEventListener(name, callback) { windowEvents.set(name, callback); },
  };
  class FileReader {
    readAsText(file) { this.onload({ target: { result: file.text } }); }
  }
  const scope = vm.createContext({
    document, window, navigator: { platform: 'iPhone', userAgent: 'iPhone', maxTouchPoints: 1 },
    getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    TextEncoder, atob, btoa, Blob, FileReader,
    URL: { createObjectURL(blob) { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    alert(message) { throw new Error(message); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../route-core.js'), 'utf8'), scope);
  vm.runInContext(script, scope);
  return { scope, get, windowEvents, downloads, blobs, get draws() { return draws; } };
}

function trace(angle, count = 20) {
  const { scope } = loadApp();
  return vm.runInContext(`
    cursor={x:50,y:50}; imgW=100; imgH=100;
    pullAngle=${angle}; reflections=${count};
    reflectPath({l:0,t:0,r:100,b:100});
  `, scope);
}

test('all four exact corners reflect inward and stay inside the board', () => {
  for (const angle of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    const points = trace(angle);
    assert.equal(points.length, 22);
    for (const p of points) {
      assert.ok(p.x >= -1e-7 && p.x <= 100 + 1e-7, JSON.stringify(p));
      assert.ok(p.y >= -1e-7 && p.y <= 100 + 1e-7, JSON.stringify(p));
    }
  }
});

test('a near-corner hit does not skip the immediately following wall', () => {
  const points = trace(Math.atan2(49.9999, 50), 2);
  assert.equal(points.length, 4);
  assert.ok(Math.abs(points[1].x - 100) < 1e-7);
  assert.ok(points[1].y < 100);
  assert.ok(Math.abs(points[2].y - 100) < 1e-7);
  assert.ok(points[2].x < 100 && points[2].x > 99.99);
});

test('horizontal, vertical, and ordinary diagonal paths remain within the walls', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.3, 1.9, -2.1]) {
    for (const p of trace(angle)) {
      assert.ok(p.x >= -1e-7 && p.x <= 100 + 1e-7);
      assert.ok(p.y >= -1e-7 && p.y <= 100 + 1e-7);
    }
  }
});

test('image load and resize finish and redraw without removed gauge variables', () => {
  const app = loadApp();
  app.get('file').onchange({ target: { files: [{}] } });
  assert.doesNotThrow(() => app.get('photo').onload());
  assert.equal(app.get('stage').hidden, false);
  const before = app.draws;
  assert.doesNotThrow(() => app.windowEvents.get('resize')());
  assert.equal(app.draws, before + 1);
});

function gesture(scope, angle, duration, length = 100, scale = 3) {
  return vm.runInContext(`makeVoiceGesture(${length},${duration},${scale},${-angle * Math.PI / 180})`, scope);
}

function coordinates(b64) {
  return [...Buffer.from(b64, 'base64').toString('latin1')
    .matchAll(/\{\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\}/g)]
    .map(m => [Number(m[1]), Number(m[2])]);
}

test('generated gestures convert to another duration with matching direction and valid timestamps', () => {
  const { scope } = loadApp();
  for (const [length, scale] of [[100, 3], [100, 2], [140, 2]]) {
    for (const angle of [0, 26.6, 45, 90, 106.4, 123.3, 151.4, 244.9, 304.3, 359.99]) {
      const original = gesture(scope, angle, 0.01, length, scale);
      const converted = vm.runInContext(`convertGestureDuration(${JSON.stringify(original)},0.5,${length},${scale})`, scope);
      const first = coordinates(original), second = coordinates(converted);
      assert.equal(second.length, 3);
      const direction = p => Math.atan2(p[2][1] - p[0][1], p[2][0] - p[0][0]);
      const delta = direction(first) - direction(second);
      assert.ok(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 0.0001);
      const bytes = Buffer.from(converted, 'base64');
      assert.equal(bytes.subarray(0, 8).toString(), 'bplist00');
      const times = [514, 653, 764, 824].map(offset => bytes.readDoubleBE(offset));
      assert.ok(Math.abs(times.at(-1) - times[0] - 0.5) < 1e-6);
      assert.ok(times.every((t, i) => i === 0 || t >= times[i - 1]));
    }
  }
});

test('batch conversion downloads a file containing every command', async () => {
  const app = loadApp();
  const a = gesture(app.scope, 26.6, 0.01), b = gesture(app.scope, 151.4, 0.01);
  app.get('voiceDuration').value = '0.5';
  const xml = `<plist><dict><key>A</key><dict><key>CustomGesture</key><data>${a}</data></dict><key>B</key><dict><key>CustomGesture</key><data>${b}</data></dict></dict></plist>`;
  app.get('voiceConvertFile').events.get('change')({ target: { files: [{ name: 'shots.voicecontrolcommands', text: xml }] } });
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].download, 'shots_0.5s.voicecontrolcommands');
  const output = await app.blobs.get(app.downloads[0].href).text();
  const data = [...output.matchAll(/<data>(.*?)<\/data>/g)];
  assert.equal(data.length, 2);
  for (const [, b64] of data) {
    const bytes = Buffer.from(b64, 'base64');
    assert.ok(Math.abs(bytes.readDoubleBE(824) - bytes.readDoubleBE(514) - 0.5) < 1e-6);
  }
});
