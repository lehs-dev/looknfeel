// Gap module: shrinks the usable work area by per-edge margins so
// maximized and tiled windows respect the gap. Implemented with invisible
// strut actors (addChrome with affectsStruts), rebuilt on any setting or
// monitor change. Ported from window-gap by Amir Hossein Karimi
// (GPL-2.0-or-later).

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

const GAP_KEYS = [
    'gap-same-on-all-edges', 'gap-size',
    'gap-top', 'gap-bottom', 'gap-left', 'gap-right',
];

export class GapModule {
    constructor(settings /* raw Gio.Settings */) {
        this._rawSettings = settings;
        this._settings = null;
        this._signals = null;
        this._actors = [];
    }

    enable() {
        this._settings = new ModuleSettings(this._rawSettings);
        this._signals = new SignalManager();
        // Register the toggle first so flipping it in prefs always works.
        this._settings.onChanged('gap-enabled', () => this._reload());
        if (!this._settings.getBoolean('gap-enabled')) {
            log('Gap module disabled by setting, skipping');
            return;
        }
        for (const key of GAP_KEYS)
            this._settings.onChanged(key, () => this._rebuild());
        this._signals.connect(Main.layoutManager, 'monitors-changed',
            () => this._rebuild());
        this._rebuild();
        log('Gap module enabled');
    }

    disable() {
        this._destroyActors();
        this._signals?.disconnectAll();
        this._signals = null;
        this._settings?.destroy();
        this._settings = null;
    }

    _reload() {
        this.disable();
        this.enable();
    }

    _getMargins() {
        if (this._settings.getBoolean('gap-same-on-all-edges')) {
            const size = this._settings.getInt('gap-size');
            return {top: size, bottom: size, left: size, right: size};
        }
        return {
            top: this._settings.getInt('gap-top'),
            bottom: this._settings.getInt('gap-bottom'),
            left: this._settings.getInt('gap-left'),
            right: this._settings.getInt('gap-right'),
        };
    }

    _rebuild() {
        this._destroyActors();
        if (!this._settings.getBoolean('gap-enabled'))
            return;
        const margins = this._getMargins();
        for (const monitor of Main.layoutManager.monitors) {
            // Clamp margins so at least 1px of usable work area remains.
            const hScale = Math.min(1, Math.max(0, monitor.width - 1) /
                Math.max(1, margins.left + margins.right));
            const vScale = Math.min(1, Math.max(0, monitor.height - 1) /
                Math.max(1, margins.top + margins.bottom));
            const top = Math.floor(margins.top * vScale);
            const bottom = Math.floor(margins.bottom * vScale);
            const left = Math.floor(margins.left * hScale);
            const right = Math.floor(margins.right * hScale);
            if (top > 0)
                this._addEdge(monitor.x, monitor.y, monitor.width, top);
            if (bottom > 0)
                this._addEdge(monitor.x, monitor.y + monitor.height - bottom,
                    monitor.width, bottom);
            if (left > 0)
                this._addEdge(monitor.x, monitor.y, left, monitor.height);
            if (right > 0)
                this._addEdge(monitor.x + monitor.width - right, monitor.y,
                    right, monitor.height);
        }
    }

    _addEdge(x, y, width, height) {
        const actor = new Clutter.Actor({
            reactive: false,
            x, y, width, height,
            opacity: 0,
        });
        Main.layoutManager.addChrome(actor, {affectsStruts: true});
        this._actors.push(actor);
    }

    _destroyActors() {
        for (const actor of this._actors) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._actors = [];
    }
}
