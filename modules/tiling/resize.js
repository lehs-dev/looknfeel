// Resize complementing: dragging a tiled window's border resizes the
// adjacent tiled windows together. Adapted from Tiling Shell's
// resizeManager.js by Domenico Ferraro (GPL-3.0-or-later).

import Meta from 'gi://Meta';
import St from 'gi://St';

import {SignalManager} from '../../shared/signals.js';

export class ResizeComplementing {
    constructor(settings, signals) {
        this._settings = settings;   // ModuleSettings
        this._signals = signals;     // module SignalManager (grab connections)
        this._resizeSignals = new SignalManager();
    }

    _isMovingOp(grabOp) {
        const op = grabOp & ~1024;
        return op === Meta.GrabOp.MOVING || op === Meta.GrabOp.KEYBOARD_MOVING;
    }

    enable() {
        this._signals.connect(global.display, 'grab-op-begin',
            (_display, window, grabOp) => {
                if (this._isMovingOp(grabOp))
                    return;
                if (!this._settings.getBoolean('tiling-auto-resize-complementing'))
                    return;
                this._onResizeBegin(window, grabOp & ~1024);
            });
        this._signals.connect(global.display, 'grab-op-end',
            (_display, _window, grabOp) => {
                if (!this._isMovingOp(grabOp))
                    this._resizeSignals.disconnectAll();
            });
    }

    disable() {
        this._resizeSignals.disconnectAll();
    }

    _onResizeBegin(window, grabOp) {
        if (!window || window.assignedTile === undefined)
            return;
        const vertical = [false, 0];
        const horizontal = [false, 0];
        switch (grabOp) {
            case Meta.GrabOp.RESIZING_N:
            case Meta.GrabOp.RESIZING_NE:
            case Meta.GrabOp.RESIZING_NW:
            case Meta.GrabOp.KEYBOARD_RESIZING_N:
            case Meta.GrabOp.KEYBOARD_RESIZING_NE:
            case Meta.GrabOp.KEYBOARD_RESIZING_NW:
                vertical[0] = true;
                vertical[1] = St.Side.TOP;
                break;
            case Meta.GrabOp.RESIZING_S:
            case Meta.GrabOp.RESIZING_SE:
            case Meta.GrabOp.RESIZING_SW:
            case Meta.GrabOp.KEYBOARD_RESIZING_S:
            case Meta.GrabOp.KEYBOARD_RESIZING_SE:
            case Meta.GrabOp.KEYBOARD_RESIZING_SW:
                vertical[0] = true;
                vertical[1] = St.Side.BOTTOM;
                break;
        }
        switch (grabOp) {
            case Meta.GrabOp.RESIZING_E:
            case Meta.GrabOp.RESIZING_NE:
            case Meta.GrabOp.RESIZING_SE:
            case Meta.GrabOp.KEYBOARD_RESIZING_E:
            case Meta.GrabOp.KEYBOARD_RESIZING_NE:
            case Meta.GrabOp.KEYBOARD_RESIZING_SE:
                horizontal[0] = true;
                horizontal[1] = St.Side.RIGHT;
                break;
            case Meta.GrabOp.RESIZING_W:
            case Meta.GrabOp.RESIZING_NW:
            case Meta.GrabOp.RESIZING_SW:
            case Meta.GrabOp.KEYBOARD_RESIZING_W:
            case Meta.GrabOp.KEYBOARD_RESIZING_NW:
            case Meta.GrabOp.KEYBOARD_RESIZING_SW:
                horizontal[0] = true;
                horizontal[1] = St.Side.LEFT;
                break;
        }
        if (!vertical[0] && !horizontal[0])
            return;
        const others = this._tiledWindowsOnMonitor(window)
            .filter(other => other !== window);
        if (others.length === 0)
            return;
        const remaining = new Set(others);
        const verticalAdjacent = vertical[0]
            ? this._findAdjacent(window, vertical[1], remaining) : [];
        const horizontalAdjacent = horizontal[0]
            ? this._findAdjacent(window, horizontal[1], remaining) : [];
        const windowsMap = new Map();
        for (const [other, otherSide] of verticalAdjacent)
            windowsMap.set(other, [other, other.get_frame_rect().copy(), otherSide, -1]);
        for (const [other, otherSide] of horizontalAdjacent) {
            const entry = windowsMap.get(other);
            if (entry)
                entry[3] = otherSide;
            else
                windowsMap.set(other, [other, other.get_frame_rect().copy(), -1, otherSide]);
        }
        const windowsToResize = [...windowsMap.values()];
        if (windowsToResize.length === 0)
            return;
        this._resizeSignals.connect(window, 'size-changed', () =>
            this._onResizing(window, window.get_frame_rect().copy(),
                vertical[1], horizontal[1], windowsToResize));
    }

    _tiledWindowsOnMonitor(window) {
        const monitor = window.get_monitor();
        return global.workspaceManager.get_active_workspace().list_windows()
            .filter(w => w.assignedTile !== undefined && !w.minimized &&
                w.get_monitor() === monitor);
    }

    _findAdjacent(window, side, remaining) {
        const result = [];
        const adjacent = [];
        const borderRect = window.get_frame_rect().copy();
        let gap = this._settings.getInt('tiling-inner-gaps');
        if (gap === 0)
            gap = 2;
        const errorFactor = gap * 4;
        switch (side) {
            case St.Side.TOP:
                borderRect.height = gap + errorFactor;
                borderRect.y -= gap + errorFactor;
                break;
            case St.Side.BOTTOM:
                borderRect.y += borderRect.height;
                borderRect.height = gap + errorFactor;
                break;
            case St.Side.LEFT:
                borderRect.width = gap + errorFactor;
                borderRect.x -= gap + errorFactor;
                break;
            case St.Side.RIGHT:
                borderRect.x += borderRect.width;
                borderRect.width = gap + errorFactor;
                break;
        }
        const opposite = side === St.Side.TOP ? St.Side.BOTTOM :
            side === St.Side.BOTTOM ? St.Side.TOP :
            side === St.Side.LEFT ? St.Side.RIGHT : St.Side.LEFT;
        const newRemaining = new Set();
        for (const other of remaining) {
            const otherRect = other.get_frame_rect();
            const [has, intersection] = otherRect.intersect(borderRect);
            let hit = has;
            if (hit) {
                switch (side) {
                    case St.Side.RIGHT:
                        hit = intersection.x <= otherRect.x;
                        break;
                    case St.Side.LEFT:
                        hit = intersection.x + intersection.width >=
                            otherRect.x + otherRect.width;
                        break;
                    case St.Side.BOTTOM:
                        hit = intersection.y <= otherRect.y;
                        break;
                    case St.Side.TOP:
                        hit = intersection.y + intersection.height >=
                            otherRect.y + otherRect.height;
                        break;
                }
            }
            if (hit) {
                result.push([other, opposite]);
                adjacent.push(other);
            } else {
                newRemaining.add(other);
            }
        }
        for (const other of adjacent) {
            for (const recursion of this._findAdjacent(other, opposite, newRemaining)) {
                result.push(recursion);
                newRemaining.delete(recursion[0]);
            }
        }
        return result;
    }

    _onResizing(window, startingRect, verticalSide, horizontalSide, windowsToResize) {
        const current = window.get_frame_rect();
        const dx = current.x - startingRect.x;
        const dy = current.y - startingRect.y;
        const dw = current.width - startingRect.width;
        const dh = current.height - startingRect.height;
        for (const [other, otherRect, vSide, hSide] of windowsToResize) {
            let x = otherRect.x;
            let y = otherRect.y;
            let width = otherRect.width;
            let height = otherRect.height;
            if (hSide === St.Side.LEFT) {
                const same = hSide === horizontalSide;
                width = otherRect.width - (same ? dx : dw);
                x = otherRect.x + (same ? dx : dw);
            } else if (hSide === St.Side.RIGHT) {
                const same = hSide === horizontalSide;
                width = otherRect.width + (same ? dw : dx);
            }
            if (vSide === St.Side.TOP) {
                const same = vSide === verticalSide;
                height = otherRect.height - (same ? dy : dh);
                y = otherRect.y + (same ? dy : dh);
            } else if (vSide === St.Side.BOTTOM) {
                const same = vSide === verticalSide;
                height = otherRect.height + (same ? dh : dy);
            }
            other.move_resize_frame(false, x, y,
                Math.max(1, width), Math.max(1, height));
        }
    }
}
