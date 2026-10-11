// Port of light-style: forces a light shell color scheme (panel, menus,
// overview) while the module is enabled, restoring the saved scheme on
// disable. Upstream has no settings and no stylesheet — just this.
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

export class LightStyleModule {
    constructor(settings) {
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();
        this._savedColorScheme = null;
    }

    enable() {
        // Register listener BEFORE the check, so toggling in prefs always
        // takes effect even when the module is off at startup.
        this._settings.onChanged('lightstyle-enabled', () => this._reload());
        if (!this._settings.getBoolean('lightstyle-enabled')) {
            log('Light style module disabled by setting, skipping');
            return;
        }
        this._savedColorScheme = Main.sessionMode.colorScheme;
        this._applyColorScheme('prefer-light');
        log('Light style module enabled');
    }

    disable() {
        if (this._savedColorScheme !== null) {
            this._applyColorScheme(this._savedColorScheme);
            this._savedColorScheme = null;
        }
        this._signals.disconnectAll();
        this._settings.destroy();
    }

    _reload() {
        this.disable();
        // disable() destroyed the ModuleSettings — re-wrap the raw settings.
        this._settings = new ModuleSettings(this._rawSettings);
        this.enable();
    }

    _applyColorScheme(scheme) {
        Main.sessionMode.colorScheme = scheme;
        St.Settings.get().notify('color-scheme');
    }
}
