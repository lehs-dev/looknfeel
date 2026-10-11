// DockActor: one dock instance per monitor. Embeds a real GNOME Dash
// (its visuals stay hidden — the animator draws magnified copies),
// owns the background pill, render area, struts/dwell chrome actors,
// layout, icon inspection and click/scroll behavior.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Dash } from 'resource:///org/gnome/shell/ui/dash.js';

import { Animator } from './animator.js';
import { AutoHide } from './autohide.js';
import {
    DockBackground, TrashIcon, MountIcon, ShowAppsIcon,
} from './dockItems.js';
import {
    getDashBox, hideDashBackground, hideShowAppsIcon, patchDash,
    getStIconFromAppwell, getAppwellDot, getContainerLabel, getFavoriteIds,
} from './dashCompat.js';
import { isInRect } from './geom.js';

export const DockPosition = {
    BOTTOM: 'bottom',
    LEFT: 'left',
    RIGHT: 'right',
    TOP: 'top',
};
const POSITIONS = [
    DockPosition.BOTTOM, DockPosition.LEFT, DockPosition.RIGHT, DockPosition.TOP,
];
const MENU_SIDE = {
    bottom: St.Side.TOP,
    top: St.Side.BOTTOM,
    left: St.Side.RIGHT,
    right: St.Side.LEFT,
};

export const DockActor = GObject.registerClass(
    { GTypeName: 'LooknFeelDockActor' },
    class DockActor extends St.Widget {
        _init(monitorIndex, settings, signals, blurModule, services) {
            super._init({
                name: 'looknfeelDock',
                reactive: false,
                track_hover: false,
                clip_to_allocation: true,
            });
            this._monitorIndex = monitorIndex;
            this._settings = settings;
            this._signals = signals;
            this._blurModule = blurModule;
            this._services = services;

            this._position = POSITIONS[settings.getInt('dock-location')] || DockPosition.BOTTOM;
            this._hidden = false;
            this._icons = null;
            this._childCount = -1;
            this._monitor = null;
            this._iconSize = 64;
            this._iconSizeScaledDown = 64;
            this._scaleFactor = 1;
            this._edgeDistance = 0;
            this._hoveredIcon = null;
            this._lastHoveredIcon = null;
            this._nearestIcon = null;
            this._favoriteIds = [];
            this._customIcons = [];
            this._unsubMounts = null;
            this._onChrome = false;
            this._pauseBounce = 0;
            this._fastForward = 0;
            this._scrollCounter = 0;
            this._cycleLocked = false;
            this.opacity = 0;

            this._background = new DockBackground();
            this.add_child(this._background);

            this.renderArea = new St.Widget({
                name: 'looknfeelDockRenderArea',
                reactive: false,
                track_hover: false,
                opacity: 0,
            });
            this.add_child(this.renderArea);

            this._struts = new St.Widget({ name: 'looknfeelDockStruts' });
            this._dwell = new St.Widget({
                name: 'looknfeelDockDwell',
                reactive: true,
                track_hover: true,
            });

            this._createDash();

            this._animator = new Animator(this, signals, settings);
            this._autohide = new AutoHide(this, signals, settings);
            if (settings.getBoolean('dock-autohide') || settings.getBoolean('dock-dodge-windows'))
                this._autohide.enable();

            this._signals.connect(this._dwell, 'motion-event',
                () => this._autohide._onMotionEvent());
            this._signals.connect(this._dwell, 'enter-event',
                () => this._autohide._onEnterEvent());
            this._signals.connect(this._dwell, 'leave-event',
                () => this._autohide._onLeaveEvent());
            this._signals.connect(AppFavorites.getAppFavorites(), 'changed',
                () => this._onAppsChanged());

            this._addToChrome();
            this._applyBackgroundStyle();
            this.layout();
            this._beginAnimation();
        }

        destroy() {
            this._autohide.disable();
            this._animator.disable();
            this._removeFromChrome();
            if (this._unsubMounts) {
                this._unsubMounts();
                this._unsubMounts = null;
            }
            for (const icon of this._customIcons)
                icon.destroy();
            this._customIcons = [];
            this._signals.disconnectAll();
            try {
                this._blurModule.unblurActor(this._background);
            } catch {
                /* ignore */
            }
            if (this._dash) {
                if (this._dash.get_parent())
                    this._dash.get_parent().remove_child(this._dash);
                this._dash.destroy();
                this._dash = null;
            }
            for (const actor of [this._struts, this._dwell]) {
                if (actor.get_parent())
                    actor.get_parent().remove_child(actor);
                actor.destroy();
            }
            super.destroy();
        }

        // ---------- dash ----------

        _createDash() {
            this._pauseBounce = 1500;
            const dash = new Dash();
            patchDash(dash);
            hideDashBackground(dash);
            hideShowAppsIcon(dash);
            dash.reactive = true;
            dash.track_hover = true;
            this._dash = dash;
            this.add_child(dash);
            dash.opacity = 0;

            this._extraIcons = new St.BoxLayout({ name: 'looknfeelDockExtraIcons' });
            getDashBox(dash)?.add_child(this._extraIcons);

            this._signals.connect(dash, 'scroll-event',
                () => Clutter.EVENT_PROPAGATE);
            this._signals.connect(dash, 'motion-event', () => this._onMotionEvent());
            this._signals.connect(dash, 'enter-event', () => this._onEnterEvent());
            this._signals.connect(dash, 'leave-event', () => this._onLeaveEvent());

            this._buildCustomIcons();
        }

        _buildCustomIcons() {
            const side = MENU_SIDE[this._position] ?? St.Side.TOP;
            if (this._settings.getBoolean('dock-show-trash')) {
                const trash = new TrashIcon(this._services, side);
                this._extraIcons.add_child(trash.container);
                this._customIcons.push(trash);
            }
            if (this._settings.getBoolean('dock-show-apps-icon')) {
                const apps = new ShowAppsIcon();
                this._extraIcons.add_child(apps.container);
                this._customIcons.push(apps);
            }
            if (this._settings.getBoolean('dock-show-mounts')) {
                for (const mount of this._services.getMounts())
                    this._addMountIcon(mount, side);
                this._unsubMounts = this._services.onMountsChanged(() => this._syncMountIcons());
            }
        }

        _addMountIcon(mount, side) {
            const icon = new MountIcon(mount, this._services,
                side ?? MENU_SIDE[this._position] ?? St.Side.TOP);
            this._extraIcons.add_child(icon.container);
            this._customIcons.push(icon);
            this._icons = null;
        }

        _syncMountIcons() {
            const mounts = this._services.getMounts();
            for (const icon of [...this._customIcons]) {
                if (icon instanceof MountIcon && !mounts.some(m => icon.matches(m))) {
                    this._extraIcons.remove_child(icon.container);
                    icon.destroy();
                    this._customIcons.splice(this._customIcons.indexOf(icon), 1);
                }
            }
            const known = this._customIcons.filter(i => i instanceof MountIcon);
            for (const mount of mounts) {
                if (!known.some(icon => icon.matches(mount)))
                    this._addMountIcon(mount);
            }
            this._icons = null;
            this._beginAnimation();
        }

        _onAppsChanged() {
            this._icons = null;
            this._fastForward = 20;
            this._beginAnimation();
            this._autohide.checkSoon();
        }

        // ---------- chrome ----------

        _addToChrome() {
            if (this._onChrome)
                return;
            const autohide = this._settings.getBoolean('dock-autohide') ||
                this._settings.getBoolean('dock-dodge-windows');
            Main.layoutManager.addChrome(this._struts, {
                affectsStruts: !autohide,
                trackFullscreen: false,
            });
            Main.layoutManager.addChrome(this, {
                affectsStruts: false,
                trackFullscreen: true,
            });
            Main.layoutManager.addChrome(this._dwell, {
                affectsStruts: false,
                trackFullscreen: false,
            });
            this._onChrome = true;
        }

        _removeFromChrome() {
            if (!this._onChrome)
                return;
            Main.layoutManager.removeChrome(this._struts);
            Main.layoutManager.removeChrome(this);
            Main.layoutManager.removeChrome(this._dwell);
            this._onChrome = false;
        }

        // ---------- geometry ----------

        isVertical() {
            return this._position === DockPosition.LEFT ||
                this._position === DockPosition.RIGHT;
        }

        getMonitor() {
            const monitors = Main.layoutManager.monitors;
            this._monitor = monitors[this._monitorIndex] ||
                Main.layoutManager.primaryMonitor;
            return this._monitor;
        }

        _snapToEdge(m) {
            const p = this._position;
            if (p === DockPosition.BOTTOM) {
                this.x = m.x + (m.width - this.width) / 2;
                this.y = m.y + m.height - this.height;
            } else if (p === DockPosition.TOP) {
                this.x = m.x + (m.width - this.width) / 2;
                this.y = m.y;
            } else if (p === DockPosition.LEFT) {
                this.x = m.x;
                this.y = m.y + (m.height - this.height) / 2;
            } else {
                this.x = m.x + m.width - this.width;
                this.y = m.y + (m.height - this.height) / 2;
            }
        }

        layout() {
            const dash = this._dash;
            const box = dash ? getDashBox(dash) : null;
            if (!dash || !box)
                return false;

            this._position = POSITIONS[this._settings.getInt('dock-location')] || DockPosition.BOTTOM;
            const vertical = this.isVertical();
            const m = this.getMonitor();
            if (!m)
                return false;
            const scaleFactor = m.geometry_scale || 1;
            this._scaleFactor = scaleFactor;

            this._icons = this._findIcons();

            const iconSize = Math.max(16,
                Math.floor(64 * this._settings.getDouble('dock-icon-size')));
            const spacing = this._settings.getDouble('dock-icon-spacing');
            const margin = 8 * spacing;
            const iconStyle = vertical
                ? `margin-top: ${margin}px; margin-bottom: ${margin}px;`
                : `margin-left: ${margin}px; margin-right: ${margin}px;`;
            const iconMargins = margin * 2 * this._icons.length;

            const spread = this._settings.getDouble('dock-spread');
            const iconSizeSpaced = iconSize + 2 + 8 * spread;
            const projected = iconSize +
                iconSizeSpaced * Math.max(this._icons.length, 3) + iconMargins;

            const limit = vertical ? 0.96 : 0.98;
            const maxLen = (vertical ? m.height : m.width) * limit;
            let scaleDown = 1;
            if (projected * scaleFactor > maxLen * 0.98)
                scaleDown = (maxLen - iconSize / 2) / (projected * scaleFactor);

            const isz = Math.floor(iconSize * scaleDown / 2) * 2;
            const iszSpaced = Math.floor(iconSizeSpaced * scaleDown / 2) * 2;
            this._iconSize = isz;
            this._iconSizeScaledDown = isz;

            this._edgeDistance = this._settings.getDouble('dock-edge-distance') * scaleFactor;
            if (this._settings.getBoolean('dock-panel-mode'))
                this._edgeDistance = 0;

            for (const entry of this._icons) {
                entry.container.width = Math.floor(iszSpaced * scaleFactor);
                entry.container.height = Math.floor(iszSpaced * scaleFactor);
                if (entry.container.style !== iconStyle)
                    entry.container.style = iconStyle;
            }

            // The actor spans the monitor; the dash hugs the screen edge.
            this.x = m.x;
            this.y = m.y;
            this.width = m.width;
            this.height = m.height;

            const orientation = vertical
                ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
            box.layout_manager.orientation = orientation;
            if (this._extraIcons)
                this._extraIcons.layout_manager.orientation = orientation;

            // Strip thickness leaves room for magnified icons.
            const magnify = this._settings.getDouble('dock-magnify') * 1.8;
            const strip = (isz * 2 + isz * (0.6 * (1 + magnify))) * scaleFactor;
            if (vertical)
                this.width = strip;
            else
                this.height = strip;
            this._snapToEdge(m);

            if (vertical) {
                dash.y = this.height / 2 - dash.height / 2;
                dash.x = this._position === DockPosition.LEFT ? 0 : this.width - dash.width;
            } else {
                dash.x = this.width / 2 - dash.width / 2;
                dash.y = this._position === DockPosition.TOP ? 0 : this.height - dash.height;
            }

            this.renderArea.set_position(0, 0);
            this.renderArea.set_size(this.width, this.height);

            // Dwell strip for autohide reveal.
            const autohideActive = this._settings.getBoolean('dock-autohide') ||
                this._settings.getBoolean('dock-dodge-windows');
            this._dwell.visible = autohideActive;
            const t = 2;
            if (vertical) {
                this._dwell.width = t;
                this._dwell.height = this.height;
                this._dwell.x = this._position === DockPosition.RIGHT ? m.x + m.width - t : m.x;
                this._dwell.y = this.y;
            } else {
                this._dwell.width = this.width;
                this._dwell.height = t;
                this._dwell.x = this.x;
                this._dwell.y = this._position === DockPosition.TOP
                    ? this.y : this.y + this.height - t;
            }
            return true;
        }

        _applyBackgroundStyle() {
            const color = this._settings.getString('dock-background-color');
            const radius = this._settings.getInt('dock-border-radius');
            this._background.style =
                `background-color: ${color}; border-radius: ${radius}px;`;
            if (this._settings.getBoolean('dock-blur-background')) {
                this._blurModule.blurActor(this._background, {
                    radius: this._settings.getInt('dock-blur-radius'),
                    brightness: this._settings.getDouble('dock-blur-brightness'),
                });
            } else {
                this._blurModule.unblurActor(this._background);
            }
        }

        // ---------- icons ----------

        _findIcons() {
            const box = getDashBox(this._dash);
            const count = box.get_children().length +
                this._extraIcons.get_children().length;
            if (this._icons && count === this._childCount)
                return this._icons;
            this._childCount = count;

            const icons = [];
            this._favoriteIds = getFavoriteIds();
            for (const child of box.get_children()) {
                const entry = this._inspectBoxChild(child);
                if (entry)
                    icons.push(entry);
            }
            for (const child of this._extraIcons.get_children()) {
                const owner = this._customIcons.find(i => i.container === child);
                if (owner?.entry)
                    icons.push(owner.entry);
            }
            this._icons = icons;
            return icons;
        }

        _inspectBoxChild(child) {
            if (!child.visible)
                return null;
            // Dash separators are not rendered by this dock.
            try {
                if ((child.get_style_class_name() || '').includes('dash-separator')) {
                    child.visible = false;
                    return null;
                }
            } catch {
                /* ignore */
            }

            const appwell = child.child; // DashIcon
            if (!appwell)
                return null;
            const stIcon = getStIconFromAppwell(appwell);
            if (!stIcon)
                return null;

            const app = appwell.app ?? null;
            const appId = app?.get_id?.() ?? '';
            if (this._settings.getBoolean('dock-favorites-only') &&
                appId && !this._favoriteIds.includes(appId)) {
                appwell.visible = false;
                return null;
            }
            appwell.visible = true;

            stIcon.opacity = 0;
            stIcon.reactive = true;
            stIcon.track_hover = true;
            const dot = getAppwellDot(appwell);
            if (dot)
                dot.opacity = 0;

            if (!child._looknfeelInit) {
                child._looknfeelInit = true;
                this._wrapAppwellActivate(child, appwell);
                this._signals.connect(stIcon, 'scroll-event',
                    (actor, evt) => this._onIconScroll(appwell, evt));
                // Self-removing: the dash rebuilds icons on its own, and a
                // stale 'destroy' entry would trip disconnectAll later.
                const destroyId = this._signals.connect(child, 'destroy', () => {
                    this._signals.disconnect(child, destroyId);
                    this._icons = null;
                });
            }

            // When animations are on, clicks land on the invisible icon and
            // bubble up to the native button; otherwise the button takes them.
            const animateOn = this._settings.getBoolean('dock-animate');
            try {
                appwell.reactive = !animateOn;
                appwell.track_hover = !animateOn;
            } catch {
                /* ignore */
            }

            return {
                container: child,
                icon: stIcon,
                label: getContainerLabel(child),
                appwell,
                appId,
                custom: false,
            };
        }

        // Click = launch / focus / minimize-toggle. Bounce on launch.
        _wrapAppwellActivate(container, appwell) {
            if (!appwell || appwell._looknfeelWrapped)
                return;
            appwell._looknfeelWrapped = true;
            const orig = appwell.activate.bind(appwell);
            const app = appwell.app;
            appwell.activate = () => {
                this._maybeBounce({ appwell, custom: false });
                let focused = null;
                try {
                    const windows = app?.get_windows?.() ?? [];
                    focused = windows.find(w => w.has_focus()) ?? null;
                } catch {
                    /* ignore */
                }
                try {
                    orig();
                } catch {
                    /* ignore */
                }
                if (focused) {
                    try {
                        for (const w of app.get_windows())
                            w.minimize();
                    } catch {
                        /* ignore */
                    }
                }
            };
        }

        _onIconScroll(appwell, evt) {
            const app = appwell?.app;
            if (!app?.get_windows)
                return Clutter.EVENT_PROPAGATE;
            const direction = evt.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP ||
                direction === Clutter.ScrollDirection.LEFT)
                this._scrollCounter += 1;
            else if (direction === Clutter.ScrollDirection.DOWN ||
                direction === Clutter.ScrollDirection.RIGHT)
                this._scrollCounter -= 1;
            else
                return Clutter.EVENT_PROPAGATE;
            this._cycleWindows(app);
            return Clutter.EVENT_STOP;
        }

        _cycleWindows(app) {
            if (this._cycleLocked)
                return;
            const wsIndex = global.workspace_manager.get_active_workspace_index();
            const windows = app.get_windows().filter(w => {
                try {
                    return w.get_workspace()?.index() === wsIndex;
                } catch {
                    return false;
                }
            });
            if (windows.length < 2) {
                this._scrollCounter = 0;
                return;
            }
            windows.sort((a, b) => b.get_id() - a.get_id());
            const current = windows.findIndex(w => {
                try {
                    return w.has_focus();
                } catch {
                    return false;
                }
            });
            const next = (((current + Math.round(this._scrollCounter)) % windows.length)
                + windows.length) % windows.length;
            this._scrollCounter = 0;
            const target = windows[next];
            if (!target || next === current)
                return;
            this._cycleLocked = true;
            this._signals.addTimer(150, () => {
                this._cycleLocked = false;
                return false;
            });
            try {
                const ws = target.get_workspace();
                if (ws && ws.index() !== wsIndex)
                    ws.activate_with_focus(target, global.get_current_time());
                else {
                    target.raise();
                    target.focus(0);
                }
            } catch {
                /* ignore */
            }
        }

        _maybeBounce(entry) {
            if (this._pauseBounce > 0)
                return;
            if (!this._settings.getBoolean('dock-bounce-on-launch'))
                return;
            const app = entry.appwell?.app;
            if (app?.get_n_windows && app.get_n_windows() !== 0 && !entry.custom)
                return;
            this._animator.bounceIcon(entry);
        }

        // ---------- animation driver ----------

        animate(dt = 15) {
            this._animator.animate(dt);
            if (this._pauseBounce > 0)
                this._pauseBounce -= dt;
            // Settle quickly after icon set changes.
            while (this._fastForward > 0) {
                this._fastForward--;
                this._animator.animate(dt);
            }
        }

        _beginAnimation() {
            this._favoriteIds = getFavoriteIds();
            this._animator.begin();
        }

        _debounceEndAnimation() {
            this._animator.debounceEnd();
        }

        _endAnimation() {
            this._icons = null;
            this._autohide.checkSoon();
        }

        slideIn() {
            if (this._hidden) {
                this._hidden = false;
                this._beginAnimation();
            }
        }

        slideOut() {
            if (!this._hidden) {
                this._hidden = true;
                this._beginAnimation();
            }
        }

        _isWithinDash(p) {
            if (this._hidden)
                return false;
            const sp = this._struts.get_transformed_position();
            return isInRect(
                [sp[0], sp[1], this._struts.width, this._struts.height], p, 20);
        }

        _onMotionEvent() {
            if (!this._monitor?.inFullscreen)
                this._beginAnimation();
            this._autohide.checkSoon();
            return Clutter.EVENT_PROPAGATE;
        }

        _onEnterEvent() {
            if (!this._monitor?.inFullscreen)
                this._beginAnimation();
            return Clutter.EVENT_PROPAGATE;
        }

        _onLeaveEvent() {
            this._autohide.checkSoon();
            this._debounceEndAnimation();
            return Clutter.EVENT_PROPAGATE;
        }
    }
);
