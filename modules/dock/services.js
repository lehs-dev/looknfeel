// Background monitors for the dock: trash state, mounted volumes and
// notification counts. Fully event-driven — no polling anywhere.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { SignalManager } from '../../shared/signals.js';
import { warn } from '../../shared/logger.js';

export class DockServices {
    constructor() {
        this._signals = new SignalManager();
        this._trashCallbacks = new Set();
        this._mountCallbacks = new Set();
        this._notices = {};
        this._trashFull = false;
        this._volumeMonitor = null;
        this._trashMonitor = null;
        this._trashFile = null;
    }

    enable() {
        // Mounted volumes — immediate add/remove signals, no polling.
        this._volumeMonitor = Gio.VolumeMonitor.get();
        this._signals.connect(this._volumeMonitor, 'mount-added',
            () => this._emitMounts());
        this._signals.connect(this._volumeMonitor, 'mount-removed',
            () => this._emitMounts());

        // Trash state via file monitor + one initial check.
        this._trashFile = Gio.File.new_for_uri('trash:///');
        try {
            this._trashMonitor = this._trashFile.monitor(
                Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._signals.connect(this._trashMonitor, 'changed',
                (monitor, file, otherFile, eventType) => {
                    if (eventType === Gio.FileMonitorEvent.CHANGED)
                        return;
                    this._checkTrash();
                });
        } catch {
            this._trashMonitor = null;
        }
        this._checkTrash();

        // Notification counts from the message tray.
        const tray = Main.messageTray;
        if (tray) {
            this._signals.connect(tray, 'source-added',
                (t, source) => this._trackSource(source));
            this._signals.connect(tray, 'source-removed',
                () => this._rescanNotices());
            for (const source of tray.getSources())
                this._trackSource(source);
            this._rescanNotices();
        }
    }

    disable() {
        this._signals.disconnectAll();
        if (this._trashMonitor) {
            try {
                this._trashMonitor.cancel();
            } catch {
                /* already gone */
            }
            this._trashMonitor = null;
        }
        this._trashFile = null;
        this._volumeMonitor = null;
        try {
            for (const source of Main.messageTray?.getSources() ?? [])
                delete source._looknfeelTracked;
        } catch {
            /* ignore */
        }
        this._trashCallbacks.clear();
        this._mountCallbacks.clear();
        this._notices = {};
    }

    get trashFull() {
        return this._trashFull;
    }

    getMounts() {
        try {
            return this._volumeMonitor?.get_mounts() ?? [];
        } catch {
            return [];
        }
    }

    getNoticeCount(appId) {
        return this._notices[appId] ?? 0;
    }

    onTrashChanged(callback) {
        this._trashCallbacks.add(callback);
        return () => this._trashCallbacks.delete(callback);
    }

    onMountsChanged(callback) {
        this._mountCallbacks.add(callback);
        return () => this._mountCallbacks.delete(callback);
    }

    emptyTrash() {
        try {
            GLib.spawn_command_line_async('gio trash --empty');
        } catch (e) {
            warn('empty trash failed:', e);
        }
    }

    openUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
        } catch (e) {
            warn('open uri failed:', uri, e);
        }
    }

    _emitMounts() {
        for (const cb of this._mountCallbacks) {
            try {
                cb();
            } catch (e) {
                warn(e);
            }
        }
    }

    _checkTrash() {
        let full = false;
        try {
            const iter = this._trashFile.enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null);
            full = iter.next_file(null) !== null;
            iter.close(null);
        } catch {
            full = false;
        }
        if (full !== this._trashFull) {
            this._trashFull = full;
            for (const cb of this._trashCallbacks) {
                try {
                    cb(full);
                } catch (e) {
                    warn(e);
                }
            }
        }
    }

    _trackSource(source) {
        if (!source || source._looknfeelTracked)
            return;
        source._looknfeelTracked = true;
        this._signals.connect(source, 'notify::count',
            () => this._rescanNotices());
    }

    _rescanNotices() {
        const notices = {};
        try {
            for (const source of Main.messageTray.getSources()) {
                const app = source.app ?? source._app ?? null;
                const id = app?.get_id?.() ?? source._appId ?? null;
                if (id && source.count > 0)
                    notices[id] = source.count;
            }
        } catch {
            /* ignore */
        }
        this._notices = notices;
    }
}
