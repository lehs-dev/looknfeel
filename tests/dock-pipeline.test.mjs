import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- minimal Clutter/St actor model ----------
let nextId = 1;
class MockActor {
    constructor(params = {}) {
        this._id = nextId++;
        Object.assign(this, {
            visible: true, opacity: 255, reactive: false, track_hover: false,
            x: 0, y: 0, width: 0, height: 0,
            translationX: 0, translationY: 0, scaleX: 1, scaleY: 1,
            _children: [], _parent: null, _mockSignals: new Map(), _destroyed: false,
            style: null, _styleClass: '',
        }, params);
        this._tx = 0; this._ty = 0; // transformed position override
    }
    add_child(c) { this._children.push(c); c._parent = this; }
    remove_child(c) {
        const i = this._children.indexOf(c);
        if (i >= 0) this._children.splice(i, 1);
        c._parent = null;
    }
    remove_all_transitions() {}
    destroy_all_children() { for (const c of [...this._children]) c.destroy(); }
    get_children() { return this._children; }
    get_parent() { return this._parent; }
    insert_child_at_index(c, i) { this._children.splice(i, 0, c); c._parent = this; }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(w, h) { this.width = w; this.height = h; }
    set_scale(sx, sy) { this.scaleX = sx; this.scaleY = sy; }
    set_style_class_name(n) { this._styleClass = n; }
    get_style_class_name() { return this._styleClass || ''; }
    get_transformed_position() { return [this._tx, this._ty]; }
    get_transformed_size() { return [this.width * this.scaleX, this.height * this.scaleY]; }
    set_position_transformed(x, y) { this._tx = x; this._ty = y; }
    connect(name, cb) { const id = nextId++; this._mockSignals.set(id, { name, cb }); return id; }
    disconnect(id) { this._mockSignals.delete(id); }
    emit(name, ...a) { for (const { name: n, cb } of this._mockSignals.values()) if (n === name) cb(this, ...a); }
    ease() {}
    _init(params = {}) { if (params) Object.assign(this, params); }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() {
        this._destroyed = true;
        this.emit('destroy');
        if (this._parent) this._parent.remove_child(this);
        for (const c of [...this._children]) c.destroy();
    }
    contains() { return false; }
}

class MockIcon extends MockActor {
    constructor(params = {}) {
        super(params);
        this.gicon = params.gicon ?? null;
        this.icon_name = params.icon_name ?? null;
        this.icon_size = params.icon_size ?? 24;
        this._syncIconSize();
    }
    _syncIconSize() {
        // real St.Icon gets implicit size from icon_size × scale
        if (this.width === 0 && this.icon_size > 0) {
            this.width = this.icon_size * this.scaleX;
            this.height = this.icon_size * this.scaleY;
        }
    }
    set_icon_size(s) { this.icon_size = s; this._syncIconSize(); }
    set_scale(sx, sy) { super.set_scale(sx, sy); this._syncIconSize(); }
    set_size(w, h) { super.set_size(w, h); }
}

const St = {
    Widget: MockActor,
    Bin: MockActor,
    BoxLayout: class extends MockActor {
        constructor(p = {}) { super(p); this.layout_manager = { orientation: 0 }; }
    },
    Label: class extends MockActor { constructor(p = {}) { super(p); this.text = p.text ?? ''; } },
    Button: MockActor,
    Icon: MockIcon,
    DrawingArea: class extends MockActor {
        queue_repaint() {}
        get_context() { return new Proxy({}, { get: () => () => ({}) }); }
        get_surface_size() { return [96, 96]; }
    },
    Side: { TOP: 0, BOTTOM: 1, LEFT: 2, RIGHT: 3 },
    ThemeContext: { get_for_stage: () => ({ scale_factor: 1 }) },
    PolicyType: { EXTERNAL: 0, NEVER: 1 },
};

const Clutter = {
    BinLayout: class {}, Orientation: { HORIZONTAL: 0, VERTICAL: 1 },
    ActorAlign: { CENTER: 1, FILL: 0 },
    EVENT_PROPAGATE: 0, EVENT_STOP: 1,
    ScrollDirection: { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 },
    AnimationMode: { EASE_OUT: 1, EASE_OUT_QUAD: 2, EASE_OUT_CUBIC: 3, LINEAR: 4 },
    TextDirection: { LTR: 0, RTL: 1 },
    ClickGesture: class {}, LongPressGesture: class {},
    get_current_event: () => null, get_default_text_direction: () => 0,
    ModifierType: { BUTTON1_MASK: 0, CONTROL_MASK: 0, SHIFT_MASK: 0 },
};

const GObject = {
    // GJS semantics: `new` runs _init, and super._init maps to the parent.
    registerClass: (...args) => {
        const cls = args.at(-1);
        return class extends cls {
            constructor(...a) { super(...a); if (typeof this._init === 'function') this._init(...a); }
        };
    },
    Object: class {},
    ParamSpec: { boolean: () => ({}), int: () => ({}), boxed: () => ({}), enum: () => ({}) },
    ParamFlags: { READWRITE: 0, READABLE: 1 },
    TypeFlags: { ABSTRACT: 0 },
    signal_handler_is_connected: () => true,
};

const timers = new Map();
let timerId = 1, vnow = 0;
const GLib = {
    PRIORITY_DEFAULT: 0,
    timeout_add(_prio, ms, cb) { const id = timerId++; timers.set(id, { cb, due: vnow + ms, ms }); return id; },
    source_remove(id) { timers.delete(id); },
};
function stepTimers(frames = 1, msPerFrame = 15) {
    for (let f = 0; f < frames; f++) {
        vnow += msPerFrame;
        for (const [id, t] of [...timers]) {
            if (vnow < t.due) continue;
            let keep = false;
            try { keep = cb_result(t.cb); } catch (e) { console.error('TIMER THROW:', e.message); throw e; }
            if (keep) t.due = vnow + t.ms;
            else timers.delete(id);
        }
    }
}
function cb_result(cb) { return cb(); }
function resetClock() { timers.clear(); vnow = 0; timerId = 1; }

const Gio = {};
const Cairo = { Operator: {}, LineCap: {} };
const Cogl = { Color: { from_string: () => [true, { red: 0, green: 0, blue: 0 }] } };
const Shell = { BlurMode: { BACKGROUND: 0 }, AppState: {}, BlurEffect: MockActor };
const Meta = {
    WindowType: { NORMAL: 0, DIALOG: 4, MODAL_DIALOG: 5, UTILITY: 9 },
    Rectangle: class { constructor(p) { Object.assign(this, p); } },
    DisplayDirection: { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3 },
};

// ---------- GNOME 50 Dash simulation (from real dash.js structure) ----------
function makeApp(id, name, iconNames) {
    const gicon = { fake: 'gicon:' + id, get_names: () => iconNames ?? [id.replace('.desktop', '')] };
    return {
        get_id: () => id, get_name: () => name,
        create_icon_texture: (size) => new St.Icon({ gicon, icon_size: size }),
        get_windows: () => [], get_n_windows: () => 0,
        connectObject() {}, app_info: { get_id: () => id },
    };
}
class BaseIcon50 {
    constructor(label, createIcon) {
        this.label = label; this.createIcon = createIcon;
        this.iconSize = 96; this.icon = null;
        this._iconBin = new MockActor({});
        this.style = '';
    }
    setIconSize(size) {
        if (size === this.iconSize) return;
        this._createIconTexture(size);
    }
    destroy() { if (this.icon) this.icon.destroy(); }
    _createIconTexture(size) {
        if (this.icon) this.icon.destroy();
        this.iconSize = size;
        this.icon = this.createIcon(this.iconSize);
        // St.Bin.child setter reparents the actor (real shell behavior)
        if (this._iconBin._children.includes(this.icon)) {
            this._iconBin.remove_child(this.icon);
        }
        this._iconBin.add_child(this.icon);
        this._iconBin.child = this.icon;
    }
}
class DashIcon50 {
    constructor(app) {
        this.app = app; this.visible = true;
        this.icon = new BaseIcon50(app.get_name(), (s) => app.create_icon_texture(s));
        this._dot = new MockActor({ opacity: 255 });
        this._delegate = this;
    }
    activate() { this._activated = true; }
    destroy() { if (this.icon) this.icon.destroy(); }
}
class DashItemContainer50 extends MockActor {
    constructor() {
        super({ style_class: 'dash-item-container' });
        this.scale_x = 0; this.scale_y = 0; this.opacity = 0;
        this.child = null; this.label = new MockActor({}); this.animatingOut = false;
    }
    setChild(a) { this.child = a; this.add_child(a); }
    show(animate) { this.scale_x = 1; this.scale_y = 1; this.opacity = 255; }
    animateOutAndDestroy() { this.destroy(); }
}
class Dash50 extends MockActor {
    constructor(favApps = [], runningApps = []) {
        super({ name: 'dash' });
        this.iconSize = 64;
        this._box = new MockActor({});
        this._box.layout_manager = { orientation: 0 };
        this._background = new MockActor({ visible: true });
        this._showAppsIcon = null;
        this._favApps = favApps; this._runningApps = runningApps;
        this._adjustIconSize = () => {};
        // deferred redisplay like the real shell
        this._pendingRedisplay = true;
    }
    _createAppItem(app) {
        const item = new DashItemContainer50();
        const icon = new DashIcon50(app);
        item.setChild(icon);
        icon.icon.setIconSize(this.iconSize);
        return item;
    }
    runDeferredRedisplay() {
        if (!this._pendingRedisplay) return;
        this._pendingRedisplay = false;
        const seen = new Set();
        for (const app of [...this._favApps, ...this._runningApps.filter(a => !this._favApps.includes(a))]) {
            if (seen.has(app.get_id())) continue;
            seen.add(app.get_id());
            const item = this._createAppItem(app);
            // patchDash wrapper hides child (applied by port code at construction;
            // emulate wrapper here only if wrapped)
            this._box.add_child(item);
            item.show(false);
        }
    }
}

const favorites = { ids: [], changedCbs: [] };
const AppFavorites = {
    getAppFavorites: () => ({
        connect: () => 1, disconnect() {},
        getIds: () => favorites.ids,
    }),
};

const monitor0 = { index: 0, x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1, inFullscreen: false };
const Main = {
    layoutManager: {
        monitors: [monitor0], primaryIndex: 0, primaryMonitor: monitor0,
        addChrome() {}, removeChrome() {},
    },
    overview: { visible: false, showApps() {} },
    uiGroup: new MockActor({}),
};
const BoxPointer = { PopupAnimation: { FULL: 0 } };
class MockMenuManager { addMenu() {} removeMenu() {} }
class MockMenu { constructor() { this.actor = new MockActor({}); } addAction() {} open() {} destroy() {} }
const PopupMenu = { PopupMenuManager: MockMenuManager, PopupMenu: MockMenu };
const globalObj = {
    get_pointer: () => [960, 500],
    workspace_manager: { get_active_workspace_index: () => 0 },
    get_window_actors: () => [],
    get_current_time: () => 0,
    stage: new MockActor({}),
};

// ---------- loader for real repo sources ----------
function loadRepo(relPath, extra = {}, capture) {
    let code = readFileSync(path.join(LOOK, relPath), 'utf8');
    code = code.replace(/^import\b[\s\S]*?;[ \t]*$/gm, '');
    code = code.replace(/\bexport default class\b/g, 'class')
        .replace(/\bexport (const|let|class|function)\b/g, '$1');
    const ctx = vm.createContext({
        console, TextDecoder,
        GLib, GObject, Gio, Cairo, Cogl, Clutter, St, Meta, Shell,
        Main, AppFavorites, BoxPointer, PopupMenu,
        global: globalObj,
        ...extra,
    });
    const ret = vm.runInContext(code + `\n;(${capture});`, ctx, { filename: relPath });
    return { ret, ctx };
}

// Load order honoring intra-repo deps
const signals = loadRepo('shared/signals.js', {}, '{SignalManager}').ret;
const settingsMod = loadRepo('shared/settings.js', { SignalManager: signals.SignalManager }, '{ModuleSettings}').ret;
const loggerMod = loadRepo('shared/logger.js', {}, '{log,debug,warn,error}').ret;
const geom = loadRepo('modules/dock/geom.js', {}, '{getDistanceSqr,isInRect,isOverlapRect}').ret;
const dashCompat = loadRepo('modules/dock/dashCompat.js',
    { St, AppFavorites }, '{getDashBox,hideDashBackground,hideShowAppsIcon,patchDash,getStIconFromAppwell,getAppwellDot,getContainerLabel,getFavoriteIds}').ret;
const drawing = loadRepo('modules/dock/drawing.js',
    { Cairo, Clutter, Cogl, GObject, St }, '{Dot}').ret;
const dockItems = loadRepo('modules/dock/dockItems.js',
    { Main, BoxPointer, PopupMenu, Clutter, GObject, St, Dot: drawing.Dot },
    '{DockBackground,TrashIcon,MountIcon,ShowAppsIcon,RunningIndicator,NotificationBadge,indicatorStyleName}').ret;
const autohide = loadRepo('modules/dock/autohide.js',
    { Meta, isInRect: geom.isInRect, isOverlapRect: geom.isOverlapRect }, '{AutoHide}').ret;
// NOTE: animator.js contains the TEMP-DEBUG DBG block — it runs here too.
const animator = loadRepo('modules/dock/animator.js',
    {
        GLib, St, getDistanceSqr: geom.getDistanceSqr,
        RunningIndicator: dockItems.RunningIndicator,
        NotificationBadge: dockItems.NotificationBadge,
        indicatorStyleName: dockItems.indicatorStyleName,
        log: loggerMod.log,
    }, '{Animator}').ret;

const appWidgets = loadRepo('modules/dock/widgets/appWidgets.js', {}, '{matchAppWidget}').ret;
class StubLiveWidget extends MockActor {
    constructor() { super({ visible: false }); this._canvas = new MockActor({}); }
    hideWidget() { this.visible = false; }
    sync() { return false; }
}
const dockActorMod = loadRepo('modules/dock/dockActor.js',
    {
        Main, AppFavorites, Clutter, GObject, Meta, St,
        Dash: Dash50,
        Animator: animator.Animator, AutoHide: autohide.AutoHide,
        ClockWidget: StubLiveWidget, CalendarWidget: StubLiveWidget,
        matchAppWidget: appWidgets.matchAppWidget,
        DockBackground: dockItems.DockBackground,
        TrashIcon: dockItems.TrashIcon, MountIcon: dockItems.MountIcon,
        ShowAppsIcon: dockItems.ShowAppsIcon,
        getDashBox: dashCompat.getDashBox, hideDashBackground: dashCompat.hideDashBackground,
        hideShowAppsIcon: dashCompat.hideShowAppsIcon, patchDash: dashCompat.patchDash,
        getStIconFromAppwell: dashCompat.getStIconFromAppwell,
        getAppwellDot: dashCompat.getAppwellDot, getContainerLabel: dashCompat.getContainerLabel,
        getFavoriteIds: dashCompat.getFavoriteIds,
        isInRect: geom.isInRect,
    }, '{DockActor,DockPosition}').ret;

// ---------- settings backend with schema defaults ----------
function makeSettings(over = {}) {
    const vals = {
        'dock-enabled': true, 'dock-location': 0, 'dock-multi-monitor': 0,
        'dock-autohide': false, 'dock-dodge-windows': false, 'dock-pressure-sense': false,
        'dock-icon-size': 1.0, 'dock-icon-spacing': 0.5, 'dock-edge-distance': 8.0,
        'dock-panel-mode': true, 'dock-animate': true, 'dock-magnify': 0.3,
        'dock-spread': 0.75, 'dock-rise': 0.25, 'dock-rise-curve': 0,
        'dock-bounce-on-launch': true, 'dock-show-trash': false, 'dock-show-mounts': false,
        'dock-show-apps-icon': true, 'dock-favorites-only': false, 'dock-clock-widget': false, 'dock-calendar-widget': false,
        'dock-background-color': 'transparent', 'dock-padding': 0.55, 'dock-border-radius': 18,
        'dock-blur-background': false, 'dock-blur-radius': 30, 'dock-blur-brightness': 0.6,
        'dock-running-indicator-style': 0,
        ...over,
    };
    return {
        get_boolean: k => { if (typeof vals[k] !== 'boolean') throw new Error('no bool ' + k); return vals[k]; },
        get_int: k => { if (!Number.isInteger(vals[k])) throw new Error('no int ' + k); return vals[k]; },
        get_string: k => { if (typeof vals[k] !== 'string') throw new Error('no str ' + k); return vals[k]; },
        get_double: k => { if (typeof vals[k] !== 'number') throw new Error('no dbl ' + k); return vals[k]; },
        connect: () => nextId++,
    };
}
const blurStub = { blurActor() {}, unblurActor() {} };
const servicesStub = {
    getMounts: () => [], onMountsChanged: () => () => {},
    getNoticeCount: () => 0, trashFull: false, onTrashChanged: () => () => {},
    openUri() {}, emptyTrash() {},
};

function buildDock(over = {}) {
    const raw = makeSettings(over);
    const ms = new settingsMod.ModuleSettings(raw);
    const sm = new signals.SignalManager();
    const dock = new dockActorMod.DockActor(0, ms, sm, blurStub, servicesStub);
    return dock;
}

// ================= TESTS =================
test('A: fresh dash with 2 favs + 1 running renders all icons incl. show-apps', () => {
    resetClock();
    const app1 = makeApp('org.gnome.Terminal.desktop', 'Terminal');
    const app2 = makeApp('org.gnome.Nautilus.desktop', 'Files');
    const app3 = makeApp('org.gnome.TextEditor.desktop', 'Editor');
    favorites.ids = [app1.get_id(), app2.get_id()];
    const dock = buildDock();
    dock._dash._favApps = [app1, app2];
    dock._dash._runningApps = [app3];
    dock._dash.runDeferredRedisplay();
    // give containers fake allocated positions (shell would allocate them)
    let xi = 100;
    for (const c of dock._dash._box.get_children()) {
        c.set_position_transformed(xi, 900); c.width = 64; c.height = 64; xi += 70;
    }
    for (const c of dock._extraIcons.get_children()) {
        c.set_position_transformed(xi, 900); c.width = 64; c.height = 64; xi += 70;
    }
    stepTimers(40); // ~600ms of frames
    const icons = dock._icons;
    console.log(`DBG-TEST icons=${icons.length} renderAreaOpacity=${dock.renderArea.opacity} dockOpacity=${dock.opacity}`);
    assert.ok(icons.length >= 4, `expected >=4 icons (2 fav + 1 running + show-apps), got ${icons.length}`);
    for (const e of icons) {
        const src = e.icon, r = e._renderer;
        assert.ok(src.gicon || src.icon_name, 'src has gicon or icon_name');
        assert.ok(r, 'renderer exists');
        assert.equal(r.visible, true, 'renderer visible');
        assert.equal(r.opacity, 255, 'renderer opacity');
        assert.ok(r.gicon || r.icon_name, 'renderer has gicon or icon_name');
        assert.ok(r.scaleX > 0, 'renderer scale > 0');
    }
    assert.ok(dock.renderArea.opacity > 0, 'renderArea faded in');
    assert.equal(dock.opacity, 255, 'dock faded in');
    dock.destroy(); resetClock();
});

test('B: dash swap (remove+add, same count) recovers without throw', () => {
    resetClock();
    const app1 = makeApp('a1.desktop', 'A1');
    const app2 = makeApp('a2.desktop', 'A2');
    const app4 = makeApp('a4.desktop', 'A4');
    favorites.ids = [app1.get_id(), app2.get_id()];
    const dock = buildDock();
    dock._dash._favApps = [app1, app2];
    dock._dash._runningApps = [];
    dock._dash.runDeferredRedisplay();
    stepTimers(40);
    assert.ok(dock._icons.length >= 3);
    // simulate shell redisplay swap: destroy app2 container, add app4 (count unchanged)
    const box = dock._dash._box;
    const kids = box.get_children().filter(c => c.child && c.child.app === app2);
    assert.equal(kids.length, 1);
    kids[0].destroy(); // fires destroy handler -> _icons = null
    const item = dock._dash._createAppItem(app4);
    box.add_child(item); item.show(false);
    item.set_position_transformed(200, 900); item.width = 64; item.height = 64;
    stepTimers(40);
    const ids = dock._icons.map(e => e.appId);
    assert.ok(ids.includes('a4.desktop'), `swapped icon present, got ${ids}`);
    dock.destroy(); resetClock();
});

test('C: icon texture replacement (theme/style change) does not blank the dock', () => {
    resetClock();
    const app1 = makeApp('b1.desktop', 'B1');
    favorites.ids = [app1.get_id()];
    const dock = buildDock();
    dock._dash._favApps = [app1];
    dock._dash._runningApps = [];
    dock._dash.runDeferredRedisplay();
    stepTimers(40);
    const before = dock._icons.length;
    assert.ok(before >= 2);
    // simulate BaseIcon._createIconTexture on style change: old St.Icon destroyed
    for (const c of dock._dash._box.get_children()) {
        const base = c.child && c.child.icon;
        if (base && base._createIconTexture) base._createIconTexture(48);
    }
    let threw = null;
    try { stepTimers(40); } catch (e) { threw = e; }
    console.log(`DBG-TEST after texture replace: threw=${threw && threw.message} icons=${dock._icons.length} r0vis=${dock._icons[0]?._renderer?.visible}`);
    assert.equal(threw, null, 'no throw after texture replacement');
    for (const e of dock._icons) {
        if (!e.custom) {
            assert.ok(e._renderer && (e._renderer.gicon || e._renderer.icon_name),
                'app renderer still has an image after texture replacement');
        }
    }
    dock.destroy(); resetClock();
});


test('D: deferred dash population (empty at construction) recovers', () => {
    resetClock();
    const app1 = makeApp('d1.desktop', 'D1');
    const app2 = makeApp('d2.desktop', 'D2');
    favorites.ids = [app1.get_id(), app2.get_id()];
    const dock = buildDock(); // dash empty: deferred work hasn't run
    stepTimers(10);
    assert.ok((dock._icons || []).length <= 1, 'only custom icons before redisplay');
    dock._dash._favApps = [app1, app2];
    dock._dash._runningApps = [];
    dock._dash.runDeferredRedisplay();
    let xi = 100;
    for (const c of dock._dash._box.get_children()) {
        if (c.set_position_transformed) { c.set_position_transformed(xi, 900); c.width = 64; c.height = 64; xi += 70; }
    }
    stepTimers(40);
    assert.ok(dock._icons.length >= 3, `recovered after deferred populate, got ${dock._icons.length}`);
    for (const e of dock._icons) {
        if (!e.custom) assert.equal(e._renderer.visible, true, `${e.appId} renderer visible`);
    }
    dock.destroy(); resetClock();
});

test('E: pointer inside dock with magnification draws all renderers', () => {
    resetClock();
    const app1 = makeApp('e1.desktop', 'E1');
    favorites.ids = [app1.get_id()];
    const dock = buildDock();
    dock._dash._favApps = [app1];
    dock._dash._runningApps = [];
    dock._dash.runDeferredRedisplay();
    let xi = 800;
    for (const c of dock._dash._box.get_children()) {
        c.set_position_transformed(xi, 900); c.width = 64; c.height = 64; xi += 70;
    }
    for (const c of dock._extraIcons.get_children()) {
        c.set_position_transformed(xi, 900); c.width = 64; c.height = 64; xi += 70;
    }
    // move pointer onto the first icon, inside struts
    globalObj.get_pointer = () => [832, 932];
    const sp = dock._struts.get_transformed_position.bind(dock._struts);
    dock._struts.set_position_transformed(0, 900);
    dock._struts.width = 1920; dock._struts.height = 120;
    stepTimers(40);
    assert.ok(dock._icons.length >= 2);
    assert.ok(dock._nearestIcon !== undefined, 'nearest icon computed');
    for (const e of dock._icons) assert.equal(e._renderer.visible, true, 'renderer visible under magnification');
    globalObj.get_pointer = () => [960, 500];
    dock.destroy(); resetClock();
});

test('F: clocks app with widget ON hides renderer and shows live widget', () => {
    resetClock();
    const clocks = makeApp('org.gnome.Clocks.desktop', 'Clocks', ['org.gnome.clocks']);
    favorites.ids = [clocks.get_id()];
    const dock = buildDock({ 'dock-clock-widget': true, 'dock-calendar-widget': false });
    dock._dash._favApps = [clocks];
    dock._dash._runningApps = [];
    dock._dash.runDeferredRedisplay();
    let xi = 100;
    for (const c of dock._dash._box.get_children()) {
        c.set_position_transformed(xi, 900); c.width = 64; c.height = 64; xi += 70;
    }
    stepTimers(40);
    const entry = dock._icons.find(e => e.appId === 'org.gnome.Clocks.desktop');
    assert.ok(entry, 'clocks entry found');
    assert.equal(entry._renderer.opacity, 0, 'static renderer hidden under widget');
    const w = dock._clockWidget;
    assert.ok(w, 'clock widget exists');
    assert.equal(w.visible, true, 'clock widget visible');
    assert.ok(w.width > 0, 'widget sized');
    assert.equal(Math.round(w.x), Math.round(entry._renderer.x), 'widget tracks renderer x');
    assert.equal(dock._calendarWidget, null, 'calendar widget not created when disabled');
    dock.destroy(); resetClock();
});

test('G: widget stays hidden when its app is absent', () => {
    resetClock();
    const app1 = makeApp('g1.desktop', 'G1', ['g1']);
    favorites.ids = [app1.get_id()];
    const dock = buildDock({ 'dock-clock-widget': true, 'dock-calendar-widget': true });
    dock._dash._favApps = [app1];
    dock._dash._runningApps = [];
    dock._dash.runDeferredRedisplay();
    stepTimers(40);
    assert.equal(dock._clockWidget.visible, false, 'clock hidden without clocks app');
    assert.equal(dock._calendarWidget.visible, false, 'calendar hidden without calendar app');
    const entry = dock._icons.find(e => e.appId === 'g1.desktop');
    assert.equal(entry._renderer.opacity, 255, 'normal icon renderer untouched');
    dock.destroy(); resetClock();
});
