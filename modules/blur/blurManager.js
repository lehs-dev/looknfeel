import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

import {NativeBlurEffect} from './effects/nativeBlur.js';
import {PanelBlur} from './components/panel.js';
import {LockscreenBlur} from './components/lockscreen.js';

const BLUR_KEYS = [
    'blur-enabled',
    'blur-panel-enabled',
    'blur-panel-radius',
    'blur-panel-brightness',
    'blur-panel-override-background',
    'blur-panel-disable-in-overview',
    'blur-lockscreen-enabled',
];

export class BlurModule {
    constructor(settings) {
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();
        this._components = this._buildComponents();
        this._actorEffects = new Map();  // actor -> effect, cho API blurActor
    }

    _buildComponents() {
        return [
            new PanelBlur(this._settings, this._signals),
            new LockscreenBlur(this._settings, this._signals),
        ];
    }

    enable() {
        // Đăng ký listener TRƯỚC khi check, để toggle trong prefs luôn có tác dụng
        // kể cả khi blur đang tắt lúc khởi động
        for (const key of BLUR_KEYS)
            this._settings.onChanged(key, () => this._reload());
        if (!this._settings.getBoolean('blur-enabled')) {
            log('Blur module disabled by setting, skipping');
            return;
        }
        for (const component of this._components)
            component.enable();
        log('Blur module enabled');
    }

    disable() {
        for (const component of this._components.toReversed())
            component.disable();
        for (const [actor, effect] of this._actorEffects) {
            if (actor && effect)
                actor.remove_effect(effect);
        }
        this._actorEffects.clear();
        this._signals.disconnectAll();
        this._settings.destroy();
    }

    _reload() {
        this.disable();
        // disable() đã destroy ModuleSettings cũ → bọc lại từ settings gốc.
        // Components giữ reference tới wrapper cũ nên phải build lại.
        this._settings = new ModuleSettings(this._rawSettings);
        this._components = this._buildComponents();
        this.enable();
    }

    // Dock (Bài 4) gọi hàm này thay vì patch trộm như integrations.js cũ
    blurActor(actor, params = {}) {
        this.unblurActor(actor);
        const effect = new NativeBlurEffect(params);
        actor.add_effect(effect);
        this._actorEffects.set(actor, effect);
        return effect;
    }

    unblurActor(actor) {
        const effect = this._actorEffects.get(actor);
        if (effect) {
            actor.remove_effect(effect);
            this._actorEffects.delete(actor);
        }
    }
}
