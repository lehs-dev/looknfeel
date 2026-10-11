import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

import {InputPanel} from './panel.js';
import {getTextStyle} from './lib.js';

const KimpanelIface = `<node>
<interface name="org.kde.impanel">
<signal name="MovePreeditCaret"><arg type="i" name="position"/></signal>
<signal name="SelectCandidate"><arg type="i" name="index"/></signal>
<signal name="LookupTablePageUp"></signal>
<signal name="LookupTablePageDown"></signal>
<signal name="TriggerProperty"><arg type="s" name="key"/></signal>
<signal name="PanelCreated"></signal>
<signal name="Exit"></signal>
<signal name="ReloadConfig"></signal>
<signal name="Configure"></signal>
</interface>
</node>`;

const Kimpanel2Iface = `<node>
<interface name="org.kde.impanel2">
<signal name="PanelCreated2"></signal>
<method name="SetSpotRect">
<arg type="i" name="x" direction="in"/><arg type="i" name="y" direction="in"/>
<arg type="i" name="w" direction="in"/><arg type="i" name="h" direction="in"/>
</method>
<method name="SetRelativeSpotRect">
<arg type="i" name="x" direction="in"/><arg type="i" name="y" direction="in"/>
<arg type="i" name="w" direction="in"/><arg type="i" name="h" direction="in"/>
</method>
<method name="SetRelativeSpotRectV2">
<arg type="i" name="x" direction="in"/><arg type="i" name="y" direction="in"/>
<arg type="i" name="w" direction="in"/><arg type="i" name="h" direction="in"/>
<arg type="d" name="scale" direction="in"/>
</method>
<method name="SetLookupTable">
<arg direction="in" type="as" name="label"/>
<arg direction="in" type="as" name="text"/>
<arg direction="in" type="as" name="attr"/>
<arg direction="in" type="b" name="hasPrev"/>
<arg direction="in" type="b" name="hasNext"/>
<arg direction="in" type="i" name="cursor"/>
<arg direction="in" type="i" name="layout"/>
</method>
</interface>
</node>`;

const HelperIface = `<node>
<interface name="org.fcitx.GnomeHelper">
<method name="LockXkbGroup"><arg direction="in" type="i" name="idx"/></method>
</interface>
</node>`;

export class KimpanelModule extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super();
        this._rawSettings = settings;
        this._settings = new ModuleSettings(settings);
        this._signals = new SignalManager();
        this._resetData();
        this._impl = null;
        this._impl2 = null;
        this._helperImpl = null;
        this._panel = null;
        this._bus = null;
        this._dbusId = 0;
        this._watchId = 0;
        this._ownerIds = [];
        this._currentService = '';
    }

    enable() {
        // Listeners first so prefs toggles always take effect.
        this._settings.onChanged('kimpanel-enabled', () => this._reload());
        this._settings.onChanged('kimpanel-vertical-list', () => {
            if (this._panel)
                this._panel.setVertical(this.isLookupTableVertical());
        });
        this._settings.onChanged('kimpanel-font', () => {
            if (this._panel)
                this._panel.updateFont(this.getTextStyle());
        });
        if (!this._settings.getBoolean('kimpanel-enabled')) {
            log('Kimpanel module disabled by setting, skipping');
            return;
        }

        this._bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        this._impl = Gio.DBusExportedObject.wrapJSObject(KimpanelIface, this);
        this._impl.export(Gio.DBus.session, '/org/kde/impanel');
        this._impl2 = Gio.DBusExportedObject.wrapJSObject(Kimpanel2Iface, this);
        this._impl2.export(Gio.DBus.session, '/org/kde/impanel');
        this._helperImpl = Gio.DBusExportedObject.wrapJSObject(HelperIface, this);
        this._helperImpl.export(Gio.DBus.session, '/org/fcitx/GnomeHelper');

        this._panel = new InputPanel(this);
        Main.layoutManager.addChrome(this._panel.panel, {});
        Main.uiGroup.add_child(this._panel._cursor);

        this._signals.connect(Main.layoutManager, 'monitors-changed',
            () => this._panel.updatePosition());
        this._dbusId = this._bus.signal_subscribe(
            null, 'org.kde.kimpanel.inputmethod', null, null, null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, object, iface, signal, param) =>
                this._parseSignal(sender, signal, param));

        this._ownerIds.push(Gio.bus_own_name(
            Gio.BusType.SESSION, 'org.kde.impanel', Gio.BusNameOwnerFlags.NONE,
            null, () => {
                this._impl.emit_signal('PanelCreated', null);
                this._impl2.emit_signal('PanelCreated2', null);
            }, null));
        this._ownerIds.push(Gio.bus_own_name(
            Gio.BusType.SESSION, 'org.fcitx.GnomeHelper',
            Gio.BusNameOwnerFlags.NONE, null, null, null));
        log('Kimpanel module enabled');
    }

    disable() {
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
        this._currentService = '';
        for (const id of this._ownerIds)
            Gio.bus_unown_name(id);
        this._ownerIds = [];
        if (this._bus && this._dbusId) {
            this._bus.signal_unsubscribe(this._dbusId);
            this._dbusId = 0;
        }
        this._bus = null;
        if (this._impl) {
            this._impl.unexport();
            this._impl = null;
        }
        if (this._impl2) {
            this._impl2.unexport();
            this._impl2 = null;
        }
        if (this._helperImpl) {
            this._helperImpl.unexport();
            this._helperImpl = null;
        }
        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
        this._resetData();
        this._signals.disconnectAll();
        this._settings.destroy();
    }

    _reload() {
        this.disable();
        // disable() destroyed the old ModuleSettings, re-wrap from raw.
        this._settings = new ModuleSettings(this._rawSettings);
        this.enable();
    }

    _resetData() {
        this.preedit = '';
        this.aux = '';
        this.label = [];
        this.table = [];
        this.pos = 0;
        this.cursor = -1;
        this.x = 0;
        this.y = 0;
        this.w = 0;
        this.h = 0;
        this.relative = false;
        this.scale = 1;
        this.layoutHint = 0;
        this.showPreedit = false;
        this.showLookupTable = false;
        this.showAux = false;
    }

    isLookupTableVertical() {
        return this.layoutHint === 0
            ? this._settings.getBoolean('kimpanel-vertical-list')
            : this.layoutHint === 1;
    }

    getTextStyle() {
        return getTextStyle(this._settings.getString('kimpanel-font'));
    }

    _parseSignal(sender, signal, param) {
        if (!this._panel)
            return;
        // Watch the input method so the panel clears when it exits.
        if (sender && sender !== this._currentService) {
            this._currentService = sender;
            if (this._watchId)
                Gio.bus_unwatch_name(this._watchId);
            this._watchId = Gio.bus_watch_name(
                Gio.BusType.SESSION, sender, Gio.BusNameWatcherFlags.NONE,
                null, (conn, name) => this._imExit(name));
        }
        const value = param.deep_unpack();
        let changed = false;
        switch (signal) {
        case 'UpdateSpotLocation':
            if (this.x !== value[0] || this.y !== value[1] ||
                this.w !== 0 || this.h !== 0)
                changed = true;
            this.x = value[0];
            this.y = value[1];
            this.w = 0;
            this.h = 0;
            break;
        case 'UpdatePreeditText':
            if (this.preedit !== value[0])
                changed = true;
            this.preedit = value[0];
            break;
        case 'UpdateAux':
            if (this.aux !== value[0])
                changed = true;
            this.aux = value[0];
            break;
        case 'UpdateLookupTable':
            changed = true;
            this.label = value[0];
            this.table = value[1];
            break;
        case 'UpdateLookupTableCursor':
            if (this.cursor !== value[0])
                changed = true;
            this.cursor = value[0];
            break;
        case 'UpdatePreeditCaret':
            if (this.pos !== value[0])
                changed = true;
            this.pos = value[0];
            break;
        case 'ShowPreedit':
            if (this.showPreedit !== value[0])
                changed = true;
            this.showPreedit = value[0];
            break;
        case 'ShowLookupTable':
            if (this.showLookupTable !== value[0])
                changed = true;
            this.showLookupTable = value[0];
            break;
        case 'ShowAux':
            if (this.showAux !== value[0])
                changed = true;
            this.showAux = value[0];
            break;
        }
        if (changed)
            this._updateInputPanel();
    }

    _imExit(name) {
        if (!this._panel || this._currentService !== name)
            return;
        this._currentService = '';
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
        this._resetData();
        this._updateInputPanel();
    }

    _updateInputPanel() {
        if (!this._panel)
            return;
        this.showAux ? this._panel.setAuxText(this.aux) : this._panel.hideAux();
        this.showPreedit
            ? this._panel.setPreeditText(this.preedit, this.pos)
            : this._panel.hidePreedit();
        this._panel.setLookupTable(this.label, this.table, this.showLookupTable);
        this._panel.setLookupTableCursor(this.cursor);
        this._panel.updatePosition();
    }

    _setRect(x, y, w, h, relative, scale) {
        // A D-Bus client can send zero/invalid scale; never divide by it.
        if (!Number.isFinite(scale) || scale <= 0)
            scale = 1;
        if (this.x === x && this.y === y && this.w === w && this.h === h &&
            this.relative === relative && this.scale === scale)
            return;
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.relative = relative;
        this.scale = scale;
        this._updateInputPanel();
    }

    // D-Bus methods called by the input method (org.kde.impanel2).
    SetSpotRect(x, y, w, h) {
        this._setRect(x, y, w, h, false, 1);
    }
    SetRelativeSpotRect(x, y, w, h) {
        this._setRect(x, y, w, h, true, 1);
    }
    SetRelativeSpotRectV2(x, y, w, h, scale) {
        this._setRect(x, y, w, h, true, scale);
    }
    SetLookupTable(labels, texts, attrs, hasPrev, hasNext, cursor, layout) {
        this.label = labels;
        this.table = texts;
        this.cursor = cursor;
        this.layoutHint = layout;
        if (this._panel)
            this._panel.setVertical(this.isLookupTableVertical());
        this._updateInputPanel();
    }

    // D-Bus method called by the input method (org.fcitx.GnomeHelper).
    LockXkbGroup(idx) {
        global.backend.lock_layout_group(idx);
    }

    // D-Bus signals emitted toward the input method (org.kde.impanel).
    selectCandidate(index) {
        this._impl.emit_signal('SelectCandidate',
            GLib.Variant.new('(i)', [index]));
    }
    triggerProperty(key) {
        this._impl.emit_signal('TriggerProperty',
            GLib.Variant.new('(s)', [key]));
    }
}
