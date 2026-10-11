import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

const KEYBINDING_NAME = 'search-shortcut';

export class SearchModule {
    constructor(settings) {
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();
        this._popupSignals = new SignalManager();
        this._visible = false;
        this._inOverview = false;
        this._keybindingAdded = false;
        this._container = null;
        this._box = null;
        this._entry = null;
        this._entryParent = null;
        this._entryIndex = 0;
        this._search = null;
        this._searchParent = null;
        this._searchIndex = 0;
        this._searchResults = null;
    }

    enable() {
        // Listeners first so prefs toggles always take effect.
        this._settings.onChanged('search-enabled', () => this._reload());
        this._settings.onChanged('search-shortcut', () => this._updateKeybinding());
        this._settings.onChanged('search-window-scale', () => this._refreshLayout());
        this._settings.onChanged('search-entry-font-size', () => this._refreshAppearance());
        if (!this._settings.getBoolean('search-enabled')) {
            log('Search module disabled by setting, skipping');
            return;
        }

        this._container = new St.Widget({
            name: 'looknfeel-search',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
        });
        this._box = new St.BoxLayout({
            name: 'looknfeel-search-box',
            vertical: true,
            reactive: true,
            style: 'border-radius: 14px; padding: 10px; ' +
                   'background-color: rgba(24, 24, 24, 0.88);',
        });
        this._container.add_child(this._box);
        Main.layoutManager.addChrome(this._container, {
            affectsStruts: false,
            trackFullscreen: false,
        });

        this._updateKeybinding();

        this._signals.connect(Main.overview, 'showing', () => {
            this._inOverview = true;
            this.hide();
        });
        this._signals.connect(Main.overview, 'hidden', () => {
            this._inOverview = false;
        });
        this._signals.connect(Main.layoutManager, 'monitors-changed',
            () => this._refreshLayout());
        log('Search module enabled');
    }

    disable() {
        this.hide();
        this._releaseOverview();
        if (this._keybindingAdded) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._keybindingAdded = false;
        }
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
            this._box = null;
        }
        this._popupSignals.disconnectAll();
        this._signals.disconnectAll();
        this._settings.destroy();
    }

    _reload() {
        this.disable();
        // disable() destroyed the old ModuleSettings, re-wrap from raw.
        this._settings = new ModuleSettings(this._rawSettings);
        this.enable();
    }

    _updateKeybinding() {
        if (this._keybindingAdded) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._keybindingAdded = false;
        }
        if (!this._settings.getBoolean('search-enabled'))
            return;
        const shortcut = this._settings.getString('search-shortcut');
        if (!shortcut)
            return;
        Main.wm.addKeybinding(
            KEYBINDING_NAME,
            this._rawSettings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => this._toggle());
        this._keybindingAdded = true;
    }

    _toggle() {
        if (this._inOverview)
            return;
        if (this._visible)
            this.hide();
        else
            this.show();
    }

    show() {
        if (this._visible || this._inOverview || !this._container)
            return;
        this._acquireOverview();
        if (!this._entry)
            return;
        this._refreshLayout();
        this._visible = true;
        this._container.show();
        this._addPopupEvents();
        const duration = this._settings.getInt('search-animation-speed');
        if (this._settings.getBoolean('search-animations') && duration > 0) {
            this._container.set_pivot_point(0.5, 0.5);
            this._container.opacity = 0;
            this._container.scale_x = 0.92;
            this._container.scale_y = 0.92;
            this._container.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration,
                mode: Clutter.AnimationMode.EASE_OUT,
            });
        } else {
            this._container.opacity = 255;
        }
        this._entry.grab_key_focus();
    }

    hide() {
        if (!this._container || !this._visible)
            return;
        this._visible = false;
        this._container.remove_all_transitions();
        this._popupSignals.disconnectAll();
        this._container.hide();
        this._container.opacity = 0;
        this._container.scale_x = 1;
        this._container.scale_y = 1;
        this._releaseOverview();
    }

    // Borrow the overview's search entry and results list so typing filters
    // the real GNOME search providers. Restored on hide/disable.
    _acquireOverview() {
        if (this._entry)
            return;
        const entry = Main.overview.searchEntry;
        const controller = Main.overview.searchController;
        if (!entry || !controller)
            return;

        this._entry = entry;
        this._entryParent = this._entry.get_parent();
        this._entryIndex = this._entryParent.get_children().indexOf(this._entry);
        this._search = controller;
        this._searchParent = this._search.get_parent();
        this._searchIndex = this._searchParent.get_children().indexOf(this._search);
        this._searchResults = this._search._searchResults;

        const results = this._searchResults;
        const self = this;
        results._looknfeelActivateDefault = results.activateDefault;
        results.activateDefault = () => {
            // Hide immediately on Enter so the launched app has no flash.
            self._container.opacity = 0;
            results._looknfeelActivateDefault();
            self.hide();
        };

        this._entry.get_parent().remove_child(this._entry);
        this._box.add_child(this._entry);
        this._search.get_parent().remove_child(this._search);
        this._box.add_child(this._search);
        this._search.hide();

        this._entry.set_style(
            `font-size: ${this._settings.getInt('search-entry-font-size')}pt;`);

        this._popupSignals.connect(this._search._text, 'text-changed', () => {
            if (this._search._text.get_text()) {
                const monitor = this._pickMonitor();
                this._box.height = Math.round(monitor.height * 0.5);
                this._search.show();
            } else {
                this._box.height = -1;
                this._search.hide();
            }
        });
    }

    _releaseOverview() {
        if (this._searchResults && this._searchResults._looknfeelActivateDefault) {
            this._searchResults.activateDefault =
                this._searchResults._looknfeelActivateDefault;
            this._searchResults._looknfeelActivateDefault = null;
        }
        if (this._entry) {
            this._entry.set_style(null);
            if (this._entry.get_parent())
                this._entry.get_parent().remove_child(this._entry);
            if (this._entryParent)
                this._entryParent.insert_child_at_index(this._entry, this._entryIndex);
            this._entry = null;
            this._entryParent = null;
        }
        if (this._search) {
            if (this._search.get_parent())
                this._search.get_parent().remove_child(this._search);
            if (this._searchParent)
                this._searchParent.insert_child_at_index(this._search, this._searchIndex);
            this._search.hide();
            this._search = null;
            this._searchParent = null;
            this._searchResults = null;
        }
    }

    _addPopupEvents() {
        this._popupSignals.connect(global.stage, 'key-press-event', (stage, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.hide();
                return Clutter.EVENT_STOP;
            }
            if (this._entry && !this._entry.contains(global.stage.get_key_focus()))
                this._entry.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
        this._popupSignals.connect(global.stage, 'notify::key-focus', () => {
            if (!this._visible || !this._entry)
                return;
            const focus = global.stage.get_key_focus();
            const inside = focus && (this._entry.contains(focus) ||
                (this._searchResults && this._searchResults.contains(focus)));
            if (!inside)
                this.hide();
        });
        this._popupSignals.connect(global.display, 'in-fullscreen-changed',
            () => this.hide());
    }

    _refreshLayout() {
        if (!this._visible || !this._container || !this._entry)
            return;
        const monitor = this._pickMonitor();
        const width = Math.max(200,
            Math.round(monitor.width * this._settings.getDouble('search-window-scale')));
        this._box.width = width;
        this._container.set_position(
            Math.round(monitor.x + (monitor.width - width) / 2),
            Math.round(monitor.y + monitor.height * 0.35));
    }

    _refreshAppearance() {
        if (this._entry)
            this._entry.set_style(
                `font-size: ${this._settings.getInt('search-entry-font-size')}pt;`);
        this._refreshLayout();
    }

    _pickMonitor() {
        const monitors = Main.layoutManager.monitors;
        const preferred = this._settings.getInt('search-preferred-monitor');
        let monitor = preferred > 0 && preferred <= monitors.length
            ? monitors[preferred - 1]
            : Main.layoutManager.primaryMonitor;
        if (!monitor)
            monitor = monitors[0];
        if (this._settings.getBoolean('search-popup-at-cursor-monitor')) {
            const [px, py] = global.get_pointer();
            for (const m of monitors) {
                if (px >= m.x && px < m.x + m.width &&
                    py >= m.y && py < m.y + m.height) {
                    monitor = m;
                    break;
                }
            }
        }
        return monitor;
    }
}
