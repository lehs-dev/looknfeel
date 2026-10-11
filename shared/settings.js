import Gio from 'gi://Gio';

import {SignalManager} from './signals.js';

export const SCHEMA_ID = 'org.gnome.shell.extensions.looknfeel';

export class ModuleSettings {
    constructor(settings) {
        this._settings = settings;
        this._signals = new SignalManager();
    }

    getBoolean(key) { return this._settings.get_boolean(key); }
    getInt(key)     { return this._settings.get_int(key); }
    getString(key)  { return this._settings.get_string(key); }
    getDouble(key)  { return this._settings.get_double(key); }

    onChanged(key, callback) {
        return this._signals.connect(this._settings, `changed::${key}`, callback);
    }

    destroy() {
        this._signals.disconnectAll();
        this._settings = null;
    }
}
