// TweaksAPI — slim primitive toolkit for the tweaks module.
// No tweak logic lives here: only the building blocks (actor helpers,
// CSS classes, prototype patching, signal block/unblock, value bag,
// system GSettings) that tweakRegistry.js entries use.
// Tweak logic adapted from just-perfection by JustPerfection (GPL-3.0).

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class TweaksAPI {
    #originals = {};  // key -> {target, prop, orig}
    #blocked = [];    // [{obj, name, id}]
    #saved = {};      // value bag

    constructor(signals) {
        this._signals = signals;
    }

    // ---------- actor helpers (null-guarded) ----------
    hideActor(actor) { actor?.hide(); }
    showActor(actor) { actor?.show(); }

    // ---------- CSS classes on uiGroup ----------
    addUiGroupClass(name) {
        Main.layoutManager.uiGroup.add_style_class_name(name);
    }

    removeUiGroupClass(name) {
        Main.layoutManager.uiGroup.remove_style_class_name(name);
    }

    // ---------- signals (owned by the module SignalManager) ----------
    connectSignal(obj, name, callback) {
        return this._signals.connect(obj, name, callback);
    }

    disconnectSignal(obj, id) {
        this._signals.disconnect(obj, id);
    }

    // ---------- block / unblock shell-owned signal handlers ----------
    blockSignal(obj, signalName) {
        if (this.#blocked.some(e => e.obj === obj && e.name === signalName))
            return;
        const id = GObject.signal_handler_find(obj, {signalId: signalName});
        if (!id)
            return;
        GObject.signal_handler_block(obj, id);
        this.#blocked.push({obj, name: signalName, id});
    }

    unblockSignal(obj, signalName) {
        const i = this.#blocked.findIndex(e => e.obj === obj && e.name === signalName);
        if (i === -1)
            return;
        const {obj: o, id} = this.#blocked[i];
        if (GObject.signal_handler_is_connected(o, id))
            GObject.signal_handler_unblock(o, id);
        this.#blocked.splice(i, 1);
    }

    unblockAllSignals() {
        for (const {obj, name} of [...this.#blocked])
            this.unblockSignal(obj, name);
    }

    // ---------- prototype patching (guarded against double-patch) ----------
    patchOnce(key, target, prop, makeReplacement) {
        if (key in this.#originals)
            return this.#originals[key].orig;
        const orig = target[prop];
        this.#originals[key] = {target, prop, orig};
        target[prop] = makeReplacement(orig);
        return orig;
    }

    restorePatched(key) {
        const rec = this.#originals[key];
        if (!rec)
            return;
        rec.target[rec.prop] = rec.orig;
        delete this.#originals[key];
    }

    restoreAllPatched() {
        for (const key of Object.keys(this.#originals))
            this.restorePatched(key);
    }

    // ---------- value save / restore bag (first write wins) ----------
    saveValue(key, value) {
        if (!(key in this.#saved))
            this.#saved[key] = value;
    }

    getSaved(key) { return this.#saved[key]; }
    hasSaved(key) { return key in this.#saved; }
    forgetSaved(key) { delete this.#saved[key]; }

    // ---------- system GSettings (org.gnome.desktop.interface) ----------
    getSystemBoolean(key) {
        return this._interfaceSettings().get_boolean(key);
    }

    setSystemBoolean(key, value) {
        this._interfaceSettings().set_boolean(key, value);
    }

    _interfaceSettings() {
        return this.__interfaceSettings ??= new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
    }

    // ---------- animation slow-down factor ----------
    setSlowDownFactor(factor) {
        this.saveValue('slowDownFactor', St.Settings.get().slow_down_factor);
        St.Settings.get().slow_down_factor = factor;
    }

    restoreSlowDownFactor() {
        if (this.hasSaved('slowDownFactor')) {
            St.Settings.get().slow_down_factor = this.getSaved('slowDownFactor');
            this.forgetSaved('slowDownFactor');
        }
    }
}
