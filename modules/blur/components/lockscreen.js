import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {NativeBlurEffect} from '../effects/nativeBlur.js';
import {log} from '../../../shared/logger.js';

// Blurs the lock-screen wallpaper, mirroring blur-my-shell's lockscreen
// component but with our native effect instead of its pipeline system.
export class LockscreenBlur {
    constructor(settings, signals) {
        this._settings = settings;  // ModuleSettings owned by BlurModule
        this._signals = signals;    // SignalManager owned by BlurModule
        this._effect = null;
        this._bg = null;
    }

    enable() {
        if (!this._settings.getBoolean('blur-lockscreen-enabled'))
            return;
        const shield = Main.screenShield;
        if (!shield)
            return;
        this._signals.connect(shield, 'lock-screen-shown', () => this._apply());
        // Already locked (e.g. key toggled from a remote session): apply now.
        if (shield.locked)
            this._apply();
        log('Lockscreen blur enabled');
    }

    disable() {
        this._remove();
    }

    _apply() {
        if (this._effect)
            return;
        const bg = Main.screenShield?._dialog?._backgroundGroup;
        if (!bg)
            return;
        this._bg = bg;
        this._effect = new NativeBlurEffect({radius: 30, brightness: 0.6});
        bg.add_effect(this._effect);
        this._signals.connect(bg, 'destroy', () => {
            this._effect = null;
            this._bg = null;
        });
    }

    _remove() {
        if (this._effect && this._bg) {
            this._bg.remove_effect(this._effect);
            this._effect = null;
            this._bg = null;
        }
    }
}
