// TweaksModule — applies the tweakRegistry entries as independent,
// individually-revertible tweaks. Mirrors modules/blur/blurManager.js:
// raw Gio.Settings in, ModuleSettings + SignalManager wrapped here,
// one settings.onChanged(key) per key for live re-apply.
// Tweak logic adapted from just-perfection by JustPerfection (GPL-3.0).

import Gio from 'gi://Gio';
import St from 'gi://St';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log, error} from '../../shared/logger.js';

import {TweaksAPI} from './api.js';
import {TWEAK_REGISTRY} from './tweakRegistry.js';

export class TweaksModule {
    constructor(settings) {
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();
        this._api = null;
        this._stylesheetFile = null;
    }

    enable() {
        // Register change listeners BEFORE the enabled-check so toggling
        // 'tweaks-enabled' in prefs always takes effect (cf. BlurModule fix).
        for (const entry of TWEAK_REGISTRY)
            this._settings.onChanged(entry.key, () => this._reapply(entry));

        if (!this._settings.getBoolean('tweaks-enabled')) {
            log('Tweaks module disabled by setting, skipping');
            return;
        }

        this._api = new TweaksAPI(this._signals);
        this._loadStylesheet();

        for (const entry of TWEAK_REGISTRY)
            this._applyEntry(entry);

        log('Tweaks module enabled');
    }

    disable() {
        if (this._api) {
            // Revert in reverse order; one bad revert must not break the rest.
            for (const entry of TWEAK_REGISTRY.toReversed()) {
                try {
                    entry.revert(this._api);
                } catch (e) {
                    error(`revert failed for ${entry.key}:`, e);
                }
            }
            // Safety nets for anything an entry missed.
            this._api.restoreAllPatched();
            this._api.unblockAllSignals();
            this._api = null;
        }
        this._unloadStylesheet();
        this._signals.disconnectAll();
        this._settings.destroy();
    }

    _reload() {
        this.disable();
        // disable() destroyed the ModuleSettings — re-wrap the raw settings.
        this._settings = new ModuleSettings(this._rawSettings);
        this.enable();
    }

    _reapply(entry) {
        if (!this._api)
            return;
        try {
            entry.revert(this._api);
        } catch (e) {
            error(`revert failed for ${entry.key}:`, e);
        }
        this._applyEntry(entry);
    }

    _applyEntry(entry) {
        const value = entry.type === 'i'
            ? this._settings.getInt(entry.key)
            : this._settings.getBoolean(entry.key);
        try {
            // Stock value: just make sure the tweak is reverted.
            if (value === entry.default)
                entry.revert(this._api);
            else
                entry.apply(this._api, value, this._settings);
        } catch (e) {
            error(`apply failed for ${entry.key}:`, e);
        }
    }

    _loadStylesheet() {
        // import.meta.url is the file:// URI of this module; derive the
        // stylesheet URI with plain string ops (the URL constructor does
        // not exist in the shell's GJS runtime).
        const uri = import.meta.url.split('/').slice(0, -1).join('/') +
            '/stylesheet.css';
        const file = Gio.File.new_for_uri(uri);
        this._stylesheetFile = file;
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(file);
    }

    _unloadStylesheet() {
        if (this._stylesheetFile) {
            St.ThemeContext.get_for_stage(global.stage).get_theme()
                .unload_stylesheet(this._stylesheetFile);
            this._stylesheetFile = null;
        }
    }
}
