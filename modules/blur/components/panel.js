import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {NativeBlurEffect} from '../effects/nativeBlur.js';
import {log} from '../../../shared/logger.js';

export class PanelBlur {
    constructor(settings, signals) {
        this._settings = settings;  // ModuleSettings dùng chung của BlurModule
        this._signals = signals;    // SignalManager dùng chung
        this._effect = null;
    }

    enable() {
        if (!this._settings.getBoolean('blur-panel-enabled'))
            return;
        this._effect = new NativeBlurEffect({
            radius: this._settings.getInt('blur-panel-radius'),
            brightness: this._settings.getDouble('blur-panel-brightness'),
        });
        Main.panel.add_effect(this._effect);
        this._signals.connect(Main.panel, 'destroy', () => { this._effect = null; });
        log('Panel blur enabled');
    }

    disable() {
        if (this._effect) {
            Main.panel.remove_effect(this._effect);
            this._effect = null;
        }
    }
}
