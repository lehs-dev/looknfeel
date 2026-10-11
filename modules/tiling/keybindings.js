// Registers tiling keybindings through Main.wm.addKeybinding and clears the
// conflicting native bindings while active (restored on disable). Adapted
// from Tiling Shell's keybindings.js by Domenico Ferraro (GPL-3.0-or-later).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {log} from '../../shared/logger.js';

// [schema key, handler name, handler arg]
const KEYBINDINGS = [
    ['tiling-move-window-right', 'move', 'right'],
    ['tiling-move-window-left', 'move', 'left'],
    ['tiling-move-window-up', 'move', 'up'],
    ['tiling-move-window-down', 'move', 'down'],
    ['tiling-focus-window-next', 'focusNext'],
    ['tiling-focus-window-prev', 'focusPrev'],
    ['tiling-focus-window-right', 'focusDirection', 'right'],
    ['tiling-focus-window-left', 'focusDirection', 'left'],
    ['tiling-focus-window-up', 'focusDirection', 'up'],
    ['tiling-focus-window-down', 'focusDirection', 'down'],
    ['tiling-untile-window', 'untile'],
];

// [schema id, key] of native bindings to clear while ours are active.
const NATIVE_OVERRIDES = [
    ['org.gnome.mutter.keybindings', 'toggle-tiled-right'],
    ['org.gnome.mutter.keybindings', 'toggle-tiled-left'],
    ['org.gnome.desktop.wm.keybindings', 'maximize'],
    ['org.gnome.desktop.wm.keybindings', 'unmaximize'],
];

export class KeybindingManager {
    constructor(settings /* raw Gio.Settings */) {
        this._settings = settings;
        this._registered = [];
        this._nativeSaved = new Map();
        this._enabled = false;
    }

    enable(handlers) {
        if (this._enabled)
            return;
        this._enabled = true;
        this._overrideNatives();
        for (const [name, handlerName, arg] of KEYBINDINGS) {
            const handler = handlers[handlerName];
            Main.wm.addKeybinding(name, this._settings,
                Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL,
                () => arg === undefined ? handler() : handler(arg));
            this._registered.push(name);
        }
        log('Tiling keybindings registered');
    }

    disable() {
        if (!this._enabled)
            return;
        this._enabled = false;
        for (const name of this._registered)
            Main.wm.removeKeybinding(name);
        this._registered = [];
        this._restoreNatives();
    }

    _overrideNatives() {
        for (const [schemaId, key] of NATIVE_OVERRIDES) {
            const id = `${schemaId}::${key}`;
            const settings = new Gio.Settings({schema_id: schemaId});
            if (!this._nativeSaved.has(id))
                this._nativeSaved.set(id, settings.get_value(key));
            settings.set_value(key, new GLib.Variant('as', []));
        }
    }

    _restoreNatives() {
        for (const [schemaId, key] of NATIVE_OVERRIDES) {
            const id = `${schemaId}::${key}`;
            const value = this._nativeSaved.get(id);
            if (value === undefined)
                continue;
            new Gio.Settings({schema_id: schemaId}).set_value(key, value);
            this._nativeSaved.delete(id);
        }
    }
}
