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

    // Tự hủy sau timeoutMs ms, trả về true để lặp lại.
    // One-shot đã chạy xong tự rời khỏi danh sách, nên disconnectAll
    // không bao giờ source_remove id chết (GLib-CRITICAL spam).
    addTimer(intervalMs, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            const keep = callback();
            if (!keep)
                this._forgetTimer(id);
            return keep;
        });
        this._timers.push(id);
        return id;
    }

    // Hủy timer qua manager để id không còn sót trong danh sách.
    cancelTimer(id) {
        if (this._forgetTimer(id))
            GLib.source_remove(id);
    }

    _forgetTimer(id) {
        const i = this._timers.indexOf(id);
        if (i === -1)
            return false;
        this._timers.splice(i, 1);
        return true;
    }

    disconnect(object, id) {
        const i = this._connections.findIndex(([o, sid]) => o === object && sid === id);
        if (i !== -1) {
            this._connections.splice(i, 1);
            this._safeDisconnect(object, id);
        }
    }

    disconnectAll() {
        // Must never throw: teardown routinely meets already-destroyed
        // actors whose JS wrappers no longer pass as GObjects. A throw
        // here aborts destroy() midway and can take the shell down.
        for (const [object, id] of this._connections)
            this._safeDisconnect(object, id);
        for (const id of [...this._timers])
            this.cancelTimer(id);
        this._connections = [];
        this._timers = [];
    }

    _safeDisconnect(object, id) {
        try {
            if (object instanceof GObject.Object &&
                GObject.signal_handler_is_connected(object, id))
                object.disconnect(id);
        } catch {
            /* object already gone */
        }
    }
}
