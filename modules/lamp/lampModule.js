import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

import {
    MagicLampMinimizeEffect,
    MagicLampUnminimizeEffect,
    MINIMIZE_EFFECT_NAME,
    UNMINIMIZE_EFFECT_NAME,
} from './effects/magicLamp.js';

export class LampModule {
    constructor(settings) {
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();
        this._hooks = null;
        this._activeEffects = new Set();
    }

    // True while minimize/unminimize are routed through the lamp effect.
    get active() {
        return this._hooks !== null;
    }

    enable() {
        // Register before the check so a prefs toggle always takes effect.
        this._settings.onChanged('lamp-enabled', () => this._reload());
        if (!this._settings.getBoolean('lamp-enabled')) {
            log('Lamp module disabled by setting, skipping');
            return;
        }
        this._installHooks();
        log('Lamp module enabled');
    }

    disable() {
        this._removeHooks();
        this._signals.disconnectAll();
        this._settings.destroy();
    }

    _reload() {
        this.disable();
        // disable() destroyed the old ModuleSettings, re-wrap from raw.
        this._settings = new ModuleSettings(this._rawSettings);
        this.enable();
    }

    _effectConfig() {
        return {
            effect: this._settings.getString('lamp-effect'),
            durationMs: this._settings.getInt('lamp-duration-ms'),
            xTiles: this._settings.getInt('lamp-x-tiles'),
            yTiles: this._settings.getInt('lamp-y-tiles'),
        };
    }

    // Public API for the dock module (called via the coordinator):
    // minimize through the hooked path so the lamp animation plays.
    // Plain metaWindow.minimize() is hooked the same way when lamp-enabled,
    // so the dock does not strictly need this call.
    minimizeWithLamp(metaWindow) {
        metaWindow.minimize();
    }

    // Drop any in-flight lamp animation for an actor.
    cancelEffects(actor) {
        if (!actor)
            return;
        for (const effect of this._activeEffects) {
            if (effect.sourceActor === actor)
                effect.destroy();
        }
        const minimizeEffect = actor.get_effect(MINIMIZE_EFFECT_NAME);
        if (minimizeEffect)
            minimizeEffect.destroy();
        const unminimizeEffect = actor.get_effect(UNMINIMIZE_EFFECT_NAME);
        if (unminimizeEffect)
            unminimizeEffect.destroy();
    }

    _installHooks() {
        // Based on js/ui/windowManager.js: swallow the default minimize /
        // unminimize completions and run the lamp effect instead.
        const hooks = this._hooks = {
            shouldAnimate: Main.wm._shouldAnimateActor,
            minimize: Main.wm._shellwm.completed_minimize,
            unminimize: Main.wm._shellwm.completed_unminimize,
        };
        hooks.shouldAnimateWrapper = function (actor, types) {
            const stack = new Error().stack;
            if (stack && (stack.includes('_minimizeWindow') || stack.includes('_unminimizeWindow')))
                return false;
            return hooks.shouldAnimate.call(this, actor, types);
        };
        Main.wm._shouldAnimateActor = hooks.shouldAnimateWrapper;

        hooks.minimizeWrapper = function (actor) {};
        Main.wm._shellwm.completed_minimize = hooks.minimizeWrapper;
        hooks.unminimizeWrapper = function (actor) {};
        Main.wm._shellwm.completed_unminimize = hooks.unminimizeWrapper;

        this._signals.connect(global.window_manager, 'minimize', (wm, actor) => {
            this.cancelEffects(actor);
            if (Main.overview.visible) {
                hooks.minimize.call(Main.wm._shellwm, actor);
                return;
            }
            this._animate(actor, MagicLampMinimizeEffect, MINIMIZE_EFFECT_NAME, true);
        });
        this._signals.connect(global.window_manager, 'unminimize', (wm, actor) => {
            this.cancelEffects(actor);
            actor.show();
            if (Main.overview.visible) {
                hooks.unminimize.call(Main.wm._shellwm, actor);
                return;
            }
            this._animate(actor, MagicLampUnminimizeEffect, UNMINIMIZE_EFFECT_NAME, false);
        });
    }

    _removeHooks() {
        const hooks = this._hooks;
        this._hooks = null;
        if (!hooks)
            return;
        // Restore first: destroying in-flight effects calls complete(), which
        // must hit the original completions, not the swallowed wrappers.
        if (Main.wm._shouldAnimateActor === hooks.shouldAnimateWrapper)
            Main.wm._shouldAnimateActor = hooks.shouldAnimate;
        if (Main.wm._shellwm.completed_minimize === hooks.minimizeWrapper)
            Main.wm._shellwm.completed_minimize = hooks.minimize;
        if (Main.wm._shellwm.completed_unminimize === hooks.unminimizeWrapper)
            Main.wm._shellwm.completed_unminimize = hooks.unminimize;

        for (const actor of global.get_window_actors())
            this.cancelEffects(actor);
        for (const effect of [...this._activeEffects])
            effect.destroy();
        this._activeEffects.clear();
    }

    _animate(actor, EffectClass, name, isMinimize) {
        const complete = isMinimize ? this._hooks.minimize : this._hooks.unminimize;
        const icon = this._getIcon(actor);
        const monitors = Main.layoutManager.monitors;
        const windowMonitor = monitors[actor.meta_window.get_monitor()];
        const targetMonitor = monitors.find(monitor =>
            icon.x >= monitor.x && icon.x < monitor.x + monitor.width &&
            icon.y >= monitor.y && icon.y <= monitor.y + monitor.height);

        let animationActor = actor;
        let snapshot = null;
        const originalOpacity = actor.opacity;

        if (windowMonitor && targetMonitor && targetMonitor !== windowMonitor) {
            // Wayland surface actors belong to their original stage views; a
            // texture snapshot can deform across outputs without those
            // per-monitor surface visibility constraints.
            const content = actor.paint_to_content(null);
            if (content) {
                snapshot = new St.Widget({
                    content,
                    x: actor.x, y: actor.y,
                    width: actor.width, height: actor.height,
                    reactive: false,
                });
                Main.uiGroup.insert_child_above(snapshot, global.window_group);
                animationActor = snapshot;
            }
        }

        const effect = new EffectClass({
            config: this._effectConfig(),
            icon,
            animationActor,
            sourceActor: snapshot ? actor : null,
            originalOpacity,
            complete: complete.bind(Main.wm._shellwm),
            onDestroy: completed => this._activeEffects.delete(completed),
        });
        this._activeEffects.add(effect);
        if (snapshot)
            actor.opacity = 0;
        animationActor.add_effect_with_name(name, effect);
    }

    _getIcon(actor) {
        const [success, rect] = actor.meta_window.get_icon_geometry();
        if (success)
            return rect;
        const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()] ||
            Main.layoutManager.primaryMonitor;
        return {
            x: monitor.x + monitor.width / 2,
            y: monitor.y + monitor.height,
            width: 0,
            height: 0,
        };
    }
}
