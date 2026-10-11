// Dock module entry point: one DockActor per monitor (primary only, or all
// monitors per dock-multi-monitor), rebuilt on monitor changes and on
// structural setting changes. Background blur goes through the blur module.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ModuleSettings } from '../../shared/settings.js';
import { SignalManager } from '../../shared/signals.js';
import { log } from '../../shared/logger.js';
import { DockActor } from './dockActor.js';
import { DockServices } from './services.js';

// Changes that require rebuilding the dock actors.
const STRUCTURAL_KEYS = [
    'dock-location', 'dock-multi-monitor', 'dock-autohide',
    'dock-dodge-windows', 'dock-panel-mode', 'dock-show-trash',
    'dock-show-mounts', 'dock-show-apps-icon', 'dock-favorites-only',
    'dock-blur-background', 'dock-clock-widget', 'dock-calendar-widget',
];
// Changes that only need a relayout + background restyle.
const LAYOUT_KEYS = [
    'dock-icon-size', 'dock-icon-spacing', 'dock-edge-distance',
    'dock-background-color', 'dock-padding', 'dock-border-radius',
    'dock-blur-radius', 'dock-blur-brightness',
];

export class DockModule {
    constructor(settings /* raw Gio.Settings */, blurModule) {
        this._rawSettings = settings;
        this._blurModule = blurModule;
        this._settings = null;
        this._signals = null;
        this._services = null;
        this._docks = new Map(); // monitorIndex -> DockActor
    }

    enable() {
        this._settings = new ModuleSettings(this._rawSettings);
        this._signals = new SignalManager();
        // Register the toggle first so flipping it in prefs always works,
        // even when the dock starts disabled.
        this._settings.onChanged('dock-enabled', () => this._reload());
        if (!this._settings.getBoolean('dock-enabled')) {
            log('Dock module disabled by setting, skipping');
            return;
        }
        this._services = new DockServices();
        this._services.enable();
        this._signals.connect(Main.layoutManager, 'monitors-changed',
            () => this._rebuild());
        for (const key of STRUCTURAL_KEYS)
            this._settings.onChanged(key, () => this._rebuild());
        for (const key of LAYOUT_KEYS)
            this._settings.onChanged(key, () => this._relayout());
        // The blur module strips all actor effects on reload — re-apply the
        // dock background blur afterwards.
        this._settings.onChanged('blur-enabled', () => this._relayout());
        this._rebuild();
        log('Dock module enabled');
    }

    disable() {
        for (const dock of this._docks.values())
            dock.destroy();
        this._docks.clear();
        if (this._services) {
            this._services.disable();
            this._services = null;
        }
        if (this._signals) {
            this._signals.disconnectAll();
            this._signals = null;
        }
        if (this._settings) {
            this._settings.destroy();
            this._settings = null;
        }
    }

    _reload() {
        // disable() destroys the ModuleSettings wrapper — re-wrap the raw
        // settings before enabling again.
        this.disable();
        this.enable();
    }

    _rebuild() {
        if (!this._settings)
            return;
        for (const dock of this._docks.values())
            dock.destroy();
        this._docks.clear();
        const monitors = Main.layoutManager.monitors;
        const all = this._settings.getInt('dock-multi-monitor') === 1;
        const indexes = all
            ? monitors.map((m, i) => i)
            : [Main.layoutManager.primaryIndex];
        for (const i of indexes) {
            const dock = new DockActor(i, this._settings, new SignalManager(),
                this._blurModule, this._services);
            this._docks.set(i, dock);
        }
        log(`Dock rebuilt on monitor(s): ${indexes.join(', ')}`);
    }

    _relayout() {
        for (const dock of this._docks.values()) {
            dock._applyBackgroundStyle();
            dock.layout();
            dock._beginAnimation();
        }
    }
}
