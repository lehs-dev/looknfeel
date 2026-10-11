import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

export class SignalManager {
    constructor() {
        this._connections = [];  // mảng [object, signalId]
        this._timers = [];       // mảng source id
    }

    connect(object, signalName, callback) {
        const id = object.connect(signalName, callback);
        this._connections.push([object, id]);
        return id;
    }

    // Tự hủy sau timeoutMs ms, trả về true để lặp lại
    addTimer(intervalMs, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, callback);
        this._timers.push(id);
        return id;
    }

    disconnect(object, id) {
        const i = this._connections.findIndex(([o, sid]) => o === object && sid === id);
        if (i !== -1) {
            if (GObject.signal_handler_is_connected(object, id))
                object.disconnect(id);
            this._connections.splice(i, 1);
        }
    }

    disconnectAll() {
        for (const [object, id] of this._connections) {
            if (object && GObject.signal_handler_is_connected(object, id))
                object.disconnect(id);
        }
        for (const id of this._timers)
            GLib.source_remove(id);
        this._connections = [];
        this._timers = [];
    }
}
