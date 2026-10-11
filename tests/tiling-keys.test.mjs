import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const LOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CTRL = 4, MOD1 = 8, SUPER = 67108864; // match Clutter masks used in code
const Clutter = {
    ModifierType: { CONTROL_MASK: CTRL, MOD1_MASK: MOD1, SUPER_MASK: SUPER },
    TextDirection: { LTR: 0, RTL: 1 },
};
const Meta = {
    GrabOp: { MOVING: 1, KEYBOARD_MOVING: 2 },
    WindowType: { NORMAL: 12 }, MaximizeFlags: { BOTH: 3 },
};
const St = { Widget: class { constructor() {} add_child() {} } };
const Main = { layoutManager: { getWorkAreaForMonitor: () => ({}) } };
const GObject = { registerClass: (...a) => a.at(-1), Object: class {} };
const log = () => {};

function loadTiling(extraSettings) {
    function load(rel, ctxExtra, capture) {
        let code = readFileSync(path.join(LOOK, rel), 'utf8');
        code = code.replace(/^import\b[\s\S]*?;[ \t]*$/gm, '')
            .replace(/\bexport default class\b/g, 'class')
            .replace(/\bexport (const|let|class|function)\b/g, '$1');
        const ctx = vm.createContext({ console, Clutter, Meta, St, Main, GObject, log, ...ctxExtra });
        return vm.runInContext(code + `\n;(${capture});`, ctx, { filename: rel });
    }
    const layouts = load('modules/tiling/layouts.js', {}, '{allTiles,tileAtPoint,tileToRect,tileWindowRect,unionTiles,tileToRect}');
    const preview = load('modules/tiling/preview.js', { GObject, St }, '{TilePreview}');
    const edge = load('modules/tiling/edgeTiling.js', {}, '{EdgeTiling}');
    const wm = load('modules/tiling/wmutils.js', { Meta }, '{maximizeWindow,unmaximizeWindow}');
    return load('modules/tiling/dragTiling.js', {
        Clutter, Meta, St, Main, SignalManager: class {}, log,
        allTiles: layouts.allTiles, tileAtPoint: layouts.tileAtPoint,
        tileToRect: layouts.tileToRect, tileWindowRect: layouts.tileWindowRect,
        unionTiles: layouts.unionTiles, TilePreview: preview.TilePreview,
        EdgeTiling: edge.EdgeTiling,
        maximizeWindow: wm.maximizeWindow, unmaximizeWindow: wm.unmaximizeWindow,
        ...extraSettings,
    }, '{DragTiling}').DragTiling;
}

function dragTilingWith(settings) {
    const DragTiling = loadTiling();
    const fakeSettings = {
        getBoolean: k => settings[k],
        getString: k => settings[k],
        getInt: () => 0,
    };
    return new DragTiling(fakeSettings, { connect() {}, disconnectAll() {} });
}

const ON = { 'tiling-tiling-system': true };

test('CTRL-drag tiles with factory defaults (activation ctrl, deactivation none)', () => {
    const d = dragTilingWith({ ...ON, 'tiling-activation-key': 'ctrl', 'tiling-deactivation-key': 'none' });
    assert.equal(d._tilingSystemActive(CTRL), true);
    assert.equal(d._tilingSystemActive(0), false);
});

test('old broken defaults (ctrl/ctrl) would never activate', () => {
    const d = dragTilingWith({ ...ON, 'tiling-activation-key': 'ctrl', 'tiling-deactivation-key': 'ctrl' });
    assert.equal(d._tilingSystemActive(CTRL), false);
});

test('explicit deactivation key suppresses tiling while held', () => {
    const d = dragTilingWith({ ...ON, 'tiling-activation-key': 'ctrl', 'tiling-deactivation-key': 'alt' });
    assert.equal(d._tilingSystemActive(CTRL), true);
    assert.equal(d._tilingSystemActive(CTRL | MOD1), false);
});

test('activation none means always active (unless deactivated)', () => {
    const d = dragTilingWith({ ...ON, 'tiling-activation-key': 'none', 'tiling-deactivation-key': 'none' });
    assert.equal(d._tilingSystemActive(0), true);
    assert.equal(d._tilingSystemActive(CTRL | MOD1 | SUPER), true);
});

test('tiling system master switch disables everything', () => {
    const d = dragTilingWith({
        'tiling-tiling-system': false,
        'tiling-activation-key': 'none', 'tiling-deactivation-key': 'none',
    });
    assert.equal(d._tilingSystemActive(0), false);
});

test('workarea helper falls back on stale monitor index', () => {
    let code = readFileSync(path.join(LOOK, 'shared/workarea.js'), 'utf8');
    code = code.replace(/^import\b[\s\S]*?;[ \t]*$/gm, '')
        .replace(/\bexport (const|let|class|function)\b/g, '$1');
    const calls = [];
    const ctx = vm.createContext({
        Main: {
            layoutManager: {
                monitors: [{ x: 0 }, { x: 1920 }],
                primaryIndex: 1,
                getWorkAreaForMonitor(i) { calls.push(i); return { m: i }; },
            },
        },
    });
    const { getWorkAreaForMonitor } = vm.runInContext(code + ';({getWorkAreaForMonitor});', ctx);
    assert.deepEqual(getWorkAreaForMonitor(0), { m: 0 });
    assert.deepEqual(getWorkAreaForMonitor(-1), { m: 1 });
    assert.deepEqual(getWorkAreaForMonitor(99), { m: 1 });
    assert.deepEqual(calls, [0, 1, 1]);
});
