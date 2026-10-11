// Port of static-workspace-background: keeps the desktop wallpaper static
// (no sliding clones) while the overview workspace-switch animation runs.
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

import {computeBounceParams} from './bounce.js';

export class WsbgModule {
    constructor(settings) {
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();

        this._groups = new Map();  // MonitorGroup -> record
        this._animations = new Map();  // MonitorGroup -> bounce animation
        this._hiddenBackgrounds = new Map();  // actor -> record
        this._origMonitorInit = null;
        this._origEaseProperty = null;
        this._monitorInitOverride = null;
        this._easePropertyOverride = null;
        this._generation = 0;
    }

    enable() {
        // Register listener BEFORE the check, so toggling in prefs always
        // takes effect even when the module is off at startup.
        this._settings.onChanged('wsbg-enabled', () => this._reload());
        if (!this._settings.getBoolean('wsbg-enabled')) {
            log('Static workspace background module disabled by setting, skipping');
            return;
        }
        if (this._origMonitorInit)
            return;
        this._generation++;
        const generation = this._generation;

        const originalMonitorInit = WorkspaceAnimation.MonitorGroup.prototype._init;
        this._origMonitorInit = originalMonitorInit;
        // Prototype overrides need the MonitorGroup as `this`, so plain
        // functions with an explicit module closure (no arrow functions).
        const module = this;
        this._monitorInitOverride = function (monitor, workspaceIndices, movingWindow) {
            originalMonitorInit.call(this, monitor, workspaceIndices, movingWindow);
            if (generation !== module._generation)
                return;
            const style = this.get_style();
            const backgrounds = this._workspaceGroups
                .filter(group => group._background)
                .map(group => [group._background, group._background.opacity]);

            // Theme paints .workspace-animation opaque and clones the
            // wallpaper, hiding real windows; the static wallpaper sits
            // underneath the sliding groups instead.
            this.set_style('background-color: transparent;');
            this._workspaceGroups.forEach(group => {
                if (group._background)
                    group._background.opacity = 0;
            });

            // Clones slide over _container and the sticky group.
            const container = new Meta.BackgroundGroup();
            const bgManager = new Background.BackgroundManager({
                container,
                monitorIndex: monitor.index,
                controlPosition: false,
            });
            this.insert_child_below(container, null);

            const destroyId = module._signals.connect(this, 'destroy',
                () => module._releaseGroup(this, true));
            module._groups.set(this, {style, backgrounds, container, bgManager, destroyId});
        };
        WorkspaceAnimation.MonitorGroup.prototype._init = this._monitorInitOverride;

        const originalEaseProperty = WorkspaceAnimation.MonitorGroup.prototype.ease_property;
        this._origEaseProperty = originalEaseProperty;
        this._easePropertyOverride = function (property, value, params = {}) {
            if (generation !== module._generation) {
                originalEaseProperty.call(this, property, value, params);
                return;
            }
            const bounce = property === 'progress'
                ? computeBounceParams({
                    duration: params.duration,
                    target: value,
                    current: this.progress,
                })
                : null;

            // Overshooting translation keeps progress in [0,1]; outside it
            // the adjustment binding yields NaN, so reset any interrupted
            // offset before starting.
            if (property === 'progress') {
                module._animations.delete(this);
                this._container.remove_transition('translation_x');
                this._container.remove_transition('translation_y');
                this._container.translation_x = 0;
                this._container.translation_y = 0;
            }

            if (bounce) {
                const animation = {target: value, params};
                module._animations.set(this, animation);
                originalEaseProperty.call(this, property, bounce.target, {
                    ...params,
                    duration: bounce.slideDuration,
                    mode: Clutter.AnimationMode.EASE_OUT_SINE,
                    onStopped: undefined,
                    onComplete: () => {
                        if (module._animations.get(this) !== animation ||
                            this.get_stage() === null)
                            return;
                        const {x, y} = module._bounceTranslation(this, bounce.overshootPx);
                        this._container.translation_x = x;
                        this._container.translation_y = y;
                        this._container.ease({
                            translation_x: 0,
                            translation_y: 0,
                            duration: bounce.returnDuration,
                            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                            onComplete: () => {
                                if (module._animations.get(this) !== animation)
                                    return;
                                module._animations.delete(this);
                                params.onComplete?.();
                            },
                            onStopped: finished => {
                                if (module._animations.get(this) !== animation)
                                    return;
                                if (!finished)
                                    module._animations.delete(this);
                                params.onStopped?.(finished);
                            },
                        });
                    },
                });
                return;
            }

            originalEaseProperty.call(this, property, value, params);
        };
        WorkspaceAnimation.MonitorGroup.prototype.ease_property = this._easePropertyOverride;

        // Hide wallpaper panels other extensions add while a switch runs.
        this._signals.connect(Main.uiGroup, 'child-added', (_, actor) => {
            if (this._groups.size > 0 && actor instanceof Meta.BackgroundGroup &&
                !this._hiddenBackgrounds.has(actor)) {
                const visible = actor.visible;
                const destroyId = this._signals.connect(actor, 'destroy',
                    () => this._hiddenBackgrounds.delete(actor));
                this._hiddenBackgrounds.set(actor, {visible, destroyId});
                actor.visible = false;
            }
        });

        log('Static workspace background module enabled');
    }

    disable() {
        this._generation++;

        if (WorkspaceAnimation.MonitorGroup.prototype._init === this._monitorInitOverride)
            WorkspaceAnimation.MonitorGroup.prototype._init = this._origMonitorInit;
        this._origMonitorInit = null;
        this._monitorInitOverride = null;

        if (WorkspaceAnimation.MonitorGroup.prototype.ease_property === this._easePropertyOverride)
            WorkspaceAnimation.MonitorGroup.prototype.ease_property = this._origEaseProperty;
        this._origEaseProperty = null;
        this._easePropertyOverride = null;

        // Finish Shell's switch callback so its modal grab and compositor
        // inhibit are released, even when disabled mid-animation.
        const animations = [...this._animations];
        this._animations.clear();
        for (const group of [...this._groups.keys()])
            this._releaseGroup(group);
        this._restoreHiddenBackgrounds();
        const completions = [];
        for (const [group, animation] of animations) {
            if (group.get_stage() === null)
                continue;
            group.remove_transition('progress');
            group._container.remove_transition('translation_x');
            group._container.remove_transition('translation_y');
            group._container.translation_x = 0;
            group._container.translation_y = 0;
            group.progress = animation.target;
            completions.push(animation.params);
        }
        for (const params of completions) {
            params.onStopped?.(true);
            params.onComplete?.();
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

    _bounceTranslation(group, overshoot) {
        if (global.workspace_manager.layout_rows === -1)
            return {x: 0, y: -overshoot};
        if (group.get_text_direction() === Clutter.TextDirection.RTL)
            return {x: overshoot, y: 0};
        return {x: -overshoot, y: 0};
    }

    _restoreHiddenBackgrounds() {
        for (const [actor, record] of this._hiddenBackgrounds) {
            this._signals.disconnect(actor, record.destroyId);
            actor.visible = record.visible;
        }
        this._hiddenBackgrounds.clear();
    }

    _releaseGroup(group, destroyed = false) {
        const record = this._groups.get(group);
        if (!record)
            return;
        this._groups.delete(group);
        if (destroyed) {
            this._animations.delete(group);
        } else {
            this._signals.disconnect(group, record.destroyId);
            group.set_style(record.style);
            for (const [background, opacity] of record.backgrounds)
                background.opacity = opacity;
        }
        record.bgManager.destroy();
        if (!destroyed)
            record.container.destroy();
        if (this._groups.size === 0)
            this._restoreHiddenBackgrounds();
    }
}
