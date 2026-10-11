// Dock visuals: the background pill, custom icons (trash, mounts,
// show-applications) and the running-indicator / notification-badge
// canvas overlays. Real app icons come from the embedded Dash — only
// these non-app items are built here.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Dot } from './drawing.js';

const INDICATOR_STYLES = [
    'dots', 'dots', 'dot', 'dashes', 'dash', 'squares', 'square',
    'segmented', 'solid', 'triangles', 'triangle', 'diamonds', 'diamond', 'binary',
];

export function indicatorStyleName(index) {
    return INDICATOR_STYLES[index] ?? 'dots';
}

export const DockBackground = GObject.registerClass(
    { GTypeName: 'LooknFeelDockBackground' },
    class DockBackground extends St.Widget {
        _init() {
            super._init({ name: 'looknfeelDockBackground' });
        }

        // Geometry follows the animated icons every frame; the CSS style
        // (color, radius) is set separately by the dock actor.
        update(p) {
            const {
                firstTx, firstTy, lastTx, lastTy,
                dashX, dashY, dashW, dashH,
                vertical, panelMode, containerW, containerH,
                iconSize, scaleFactor,
            } = p;
            if (firstTx === undefined || dashW <= 0 || dashH <= 0) {
                this.opacity = 0;
                return;
            }
            const padding = iconSize * 0.05 * scaleFactor;
            let x = dashX, y = dashY, w = dashW, h = dashH;
            if (vertical) {
                y += firstTy;
                h += lastTy - firstTy;
            } else {
                x += firstTx;
                w += lastTx - firstTx;
            }
            x -= padding;
            w += padding * 2;
            y -= padding;
            h += padding * 2;
            const az = -padding;
            x += az / 2;
            w -= az * (vertical ? 1 : 2);
            y += az / 2;
            h -= az * (vertical ? 2 : 1);
            if (panelMode) {
                if (vertical) {
                    y = 0;
                    h = containerH;
                } else {
                    x = 0;
                    w = containerW;
                }
            }
            if ([x, y, w, h].some(v => isNaN(v)) || w <= 0 || h <= 0) {
                this.opacity = 0;
                return;
            }
            this.set_position(Math.round(x), Math.round(y));
            this.set_size(Math.round(w), Math.round(h));
            this.opacity = 255;
        }
    }
);

// Base for trash / mount / show-apps: an invisible-icon container shaped
// exactly like a dash icon entry so the animator treats it uniformly.
// Structure: container (sized by layout) > inner (carries translations)
// > icon (St.Icon, opacity 0, reactive — hit target for clicks).
class CustomIcon {
    constructor(name, labelText) {
        this.container = new St.Widget({ name, reactive: true, track_hover: true });
        this._inner = new St.Widget({ name: `${name}Inner` });
        this.container.add_child(this._inner);
        this.icon = null;
        this.label = new St.Label({ style_class: 'dash-label', text: labelText });
        this.label.opacity = 0;
        Main.uiGroup.add_child(this.label);
        this.entry = null;
        this._menu = null;
        this._menuManager = null;
    }

    _setIcon(icon) {
        this.icon = icon;
        this.icon.reactive = true;
        this.icon.track_hover = true;
        this.icon.opacity = 0;
        this._inner.add_child(this.icon);
        this.entry = {
            container: this.container,
            icon: this.icon,
            label: this.label,
            appwell: null,
            appId: null,
            custom: true,
        };
    }

    _attachMenu(side) {
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new PopupMenu.PopupMenu(this.container, 0.5, side);
        this._menuManager.addMenu(this._menu);
        Main.uiGroup.add_child(this._menu.actor);
        return this._menu;
    }

    _onButtonPress(evt, onLeftClick) {
        const button = evt.get_button();
        if (button === 3 && this._menu) {
            this._menu.open(BoxPointer.PopupAnimation.FULL);
            return Clutter.EVENT_STOP;
        }
        if (button === 1) {
            onLeftClick();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        if (this._menuManager && this._menu)
            this._menuManager.removeMenu(this._menu);
        if (this._menu)
            this._menu.destroy();
        this._menu = null;
        this._menuManager = null;
        if (this.label.get_parent())
            this.label.get_parent().remove_child(this.label);
        this.label.destroy();
    }
}

export class TrashIcon extends CustomIcon {
    constructor(services, menuSide) {
        super('looknfeelTrashIcon', 'Trash');
        this._services = services;
        this._setIcon(new St.Icon({ icon_name: 'user-trash', icon_size: 48 }));
        this._updateIcon(services.trashFull);
        this._unsub = services.onTrashChanged(full => this._updateIcon(full));
        this.container.connect('button-press-event', (actor, evt) =>
            this._onButtonPress(evt, () => services.openUri('trash:///')));
        this._attachMenu(menuSide).addAction('Empty Trash',
            () => services.emptyTrash());
    }

    _updateIcon(full) {
        if (this.icon)
            this.icon.icon_name = full ? 'user-trash-full' : 'user-trash';
    }

    destroy() {
        this._unsub?.();
        super.destroy();
    }
}

export class MountIcon extends CustomIcon {
    constructor(mount, services, menuSide) {
        super('looknfeelMountIcon', mount.get_name());
        this._services = services;
        this._mount = mount;
        this._uri = mount.get_default_location().get_uri();
        this._setIcon(new St.Icon({ gicon: mount.get_icon(), icon_size: 48 }));
        this.container.connect('button-press-event', (actor, evt) =>
            this._onButtonPress(evt, () => services.openUri(this._uri)));
        this._attachMenu(menuSide).addAction('Eject', () => this._eject());
    }

    matches(mount) {
        try {
            return mount.get_default_location().get_uri() === this._uri;
        } catch {
            return false;
        }
    }

    _eject() {
        const mount = this._mount;
        try {
            mount.eject_with_operation(0, null, null, (m, res) => {
                try {
                    m.eject_with_operation_finish(res);
                } catch {
                    /* ignore */
                }
            });
        } catch {
            try {
                mount.unmount_with_operation(0, null, null, (m, res) => {
                    try {
                        m.unmount_with_operation_finish(res);
                    } catch {
                        /* ignore */
                    }
                });
            } catch {
                /* ignore */
            }
        }
    }
}

export class ShowAppsIcon extends CustomIcon {
    constructor() {
        super('looknfeelShowAppsIcon', 'Show Applications');
        this._setIcon(new St.Icon({ icon_name: 'view-app-grid-symbolic', icon_size: 48 }));
        this.container.connect('button-press-event', (actor, evt) =>
            this._onButtonPress(evt, () => Main.overview.showApps()));
    }
}

// Shared placement logic for the canvas overlays (not a GObject base class —
// each overlay is registered separately below).
function placeOverlay(widget, dot, x, y, size, scale) {
    widget.set_position(Math.round(x), Math.round(y));
    widget.set_size(Math.round(size), Math.round(size));
    const s = size / 96;
    dot.set_scale(s, s);
    widget.set_scale(scale, scale);
}

export const RunningIndicator = GObject.registerClass(
    { GTypeName: 'LooknFeelRunningIndicator' },
    class RunningIndicator extends St.Widget {
        _init() {
            super._init({ name: 'looknfeelRunningIndicator' });
            this._dot = new Dot(96);
            this.add_child(this._dot);
        }

        update({ count, style, rotate }) {
            this._dot.set_state({
                count,
                color: [1, 1, 1, 1],
                style,
                size: 0,
                rotate: rotate || 0,
            });
        }

        place(x, y, size, scale) {
            placeOverlay(this, this._dot, x, y, size, scale);
        }
    }
);

export const NotificationBadge = GObject.registerClass(
    { GTypeName: 'LooknFeelNotificationBadge' },
    class NotificationBadge extends St.Widget {
        _init() {
            super._init({ name: 'looknfeelNotificationBadge' });
            this._dot = new Dot(96);
            this.add_child(this._dot);
        }

        update({ count }) {
            this._dot.set_state({
                count,
                color: [0.95, 0.25, 0.25, 1],
                style: 'dot',
                size: 0,
                rotate: 0,
            });
        }

        place(x, y, size) {
            placeOverlay(this, this._dot, x, y, size, 1);
        }
    }
);
