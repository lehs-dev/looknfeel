// Autohide (dwell reveal) + intellihide (dodge windows) for the dock.
// A 2px reactive strip at the screen edge reveals a hidden dock; with
// dodge enabled the dock additionally hides only when a window overlaps it.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import Meta from 'gi://Meta';

import { isInRect, isOverlapRect } from './geom.js';

const HIDE_DEBOUNCE_MS = 120;
const REVEAL_DELAY_MS = 100;

// Window types that participate in intellihide (from dash-to-dock).
const HANDLED_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
];

export class AutoHide {
    constructor(dock, signals, settings) {
        this._dock = dock;
        this._signals = signals;
        this._settings = settings;
        this._enabled = false;
        this._shown = true;
        this._tracked = new Map(); // Meta.Window -> signal ids
        this._hidePending = false;
        this._revealPending = false;
    }

    _active() {
        return this._enabled &&
            (this._settings.getBoolean('dock-autohide') ||
             this._settings.getBoolean('dock-dodge-windows'));
    }

    enable() {
        if (this._enabled)
            return;
        this._enabled = true;
        this._shown = true;
        this.checkSoon();
    }

    disable() {
        if (!this._enabled)
            return;
        this._enabled = false;
        this._hidePending = false;
        this._revealPending = false;
        for (const window of [...this._tracked.keys()])
            this._untrack(window);
        this.show();
    }

    checkSoon() {
        if (!this._active() || this._hidePending)
            return;
        this._hidePending = true;
        this._signals.addTimer(HIDE_DEBOUNCE_MS, () => {
            this._hidePending = false;
            this._checkHide();
            return false;
        });
    }

    show() {
        this._revealPending = false;
        const monitor = this._dock._monitor;
        if (!monitor || monitor.inFullscreen)
            return;
        this._shown = true;
        this._dock.slideIn();
    }

    hide() {
        this._revealPending = false;
        this._shown = false;
        this._dock.slideOut();
    }

    _checkHide() {
        if (!this._active())
            return;
        if (this._checkOverlap())
            this.hide();
        else
            this.show();
    }

    _checkOverlap() {
        const dodge = this._settings.getBoolean('dock-dodge-windows');
        const pointer = global.get_pointer();
        const struts = this._dock._struts;
        const sp = struts.get_transformed_position();
        const strutRect = [sp[0], sp[1], struts.width, struts.height];

        if (this._shown !== false &&
            (this._dock._isWithinDash(pointer) || isInRect(strutRect, pointer)))
            return false;
        if (!dodge)
            return true; // pure autohide: hide whenever the pointer leaves

        const monitor = this._dock._monitor;
        if (!monitor)
            return false;
        if (monitor.inFullscreen)
            return true;

        const wsIndex = global.workspace_manager.get_active_workspace_index();
        let overlapped = false;
        for (const actor of global.get_window_actors()) {
            let window = null;
            try {
                window = actor.get_meta_window();
            } catch {
                continue;
            }
            if (!window || !window.can_close())
                continue;
            if (window.get_monitor() !== monitor.index)
                continue;
            if (!HANDLED_WINDOW_TYPES.includes(window.get_window_type()))
                continue;
            const ws = window.get_workspace();
            if (!ws || ws.index() !== wsIndex || !window.showing_on_its_workspace())
                continue;
            this._track(window);
            if (overlapped)
                continue;
            const f = window.get_frame_rect();
            if (isOverlapRect(strutRect, [f.x, f.y, f.width, f.height]))
                overlapped = true;
        }
        return overlapped;
    }

    // Dwell-strip events (wired by the dock actor).
    _onMotionEvent() {
        if (!this._active() || this._shown)
            return;
        if (!this._isAtRevealEdge(global.get_pointer())) {
            this._revealPending = false;
            return;
        }
        if (this._revealPending)
            return;
        this._revealPending = true;
        this._signals.addTimer(REVEAL_DELAY_MS, () => {
            const pending = this._revealPending;
            this._revealPending = false;
            if (pending && this._active() && !this._shown &&
                this._isAtRevealEdge(global.get_pointer()))
                this.show();
            return false;
        });
    }

    _onEnterEvent() {
        this._onMotionEvent();
    }

    _onLeaveEvent() {
        this._revealPending = false;
        if (this._shown)
            this.checkSoon();
    }

    _isAtRevealEdge(pointer) {
        const monitor = this._dock._monitor;
        const dwell = this._dock._dwell;
        if (!monitor || !dwell || monitor.inFullscreen)
            return false;
        const [x, y] = pointer;
        if (x < monitor.x || x >= monitor.x + monitor.width ||
            y < monitor.y || y >= monitor.y + monitor.height)
            return false;
        const [edgeX, edgeY] = dwell.get_transformed_position();
        if (!isInRect([edgeX, edgeY, dwell.width, dwell.height], pointer))
            return false;
        // With pressure sense only the outermost pixel summons the dock;
        // otherwise the whole 2px strip counts.
        if (!this._settings.getBoolean('dock-pressure-sense'))
            return true;
        switch (this._dock._position) {
            case 'left': return x < monitor.x + 1;
            case 'right': return x >= monitor.x + monitor.width - 1;
            case 'top': return y < monitor.y + 1;
            case 'bottom': return y >= monitor.y + monitor.height - 1;
            default: return false;
        }
    }

    // Window tracking uses raw connects (not the shared SignalManager) so
    // unmanaged/destroyed windows can be untracked without tripping the
    // manager's disconnect-all pass.
    _track(window) {
        if (this._tracked.has(window))
            return;
        const ids = [];
        try {
            ids.push(window.connect('position-changed', () => this.checkSoon()));
            ids.push(window.connect('size-changed', () => this.checkSoon()));
            ids.push(window.connect('unmanaged', () => this._untrack(window)));
        } catch {
            this._untrack(window);
            return;
        }
        this._tracked.set(window, ids);
    }

    _untrack(window) {
        const ids = this._tracked.get(window);
        if (!ids)
            return;
        this._tracked.delete(window);
        for (const id of ids) {
            try {
                window.disconnect(id);
            } catch {
                /* already destroyed */
            }
        }
    }
}
