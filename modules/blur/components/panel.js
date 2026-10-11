import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {NativeBlurEffect} from '../effects/nativeBlur.js';
import {log} from '../../../shared/logger.js';

export class PanelBlur {
    constructor(settings, signals) {
        this._settings = settings;  // ModuleSettings owned by BlurModule
        this._signals = signals;     // SignalManager owned by BlurModule
        this._effect = null;
    }

    enable() {
        if (!this._settings.getBoolean('blur-panel-enabled'))
            return;
        this._addEffect();
        if (this._settings.getBoolean('blur-panel-override-background'))
            Main.panel.set_style('background-color: transparent;');
        if (this._settings.getBoolean('blur-panel-disable-in-overview')) {
            this._signals.connect(Main.overview, 'showing', () => this._removeEffect());
            this._signals.connect(Main.overview, 'hidden', () => {
                if (this._settings.getBoolean('blur-panel-enabled'))
                    this._addEffect();
            });
        }
        log('Panel blur enabled');
    }

    disable() {
        this._removeEffect();
        Main.panel?.set_style(null);
    }

    _addEffect() {
        if (this._effect)
            return;
        this._effect = new NativeBlurEffect({
            radius: this._settings.getInt('blur-panel-radius'),
            brightness: this._settings.getDouble('blur-panel-brightness'),
        });
        Main.panel.add_effect(this._effect);
        this._signals.connect(Main.panel, 'destroy', () => { this._effect = null; });
    }

    _removeEffect() {
        if (this._effect) {
            Main.panel.remove_effect(this._effect);
            this._effect = null;
        }
    }
}
