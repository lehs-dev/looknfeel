// Drag-to-tile and edge tiling. The tiling layout overlay appears while the
// activation key is held during a drag; otherwise dragging against a screen
// edge previews the edge tile. Window motion is tracked through the
// window's position-changed signal (no polling). Lean port of Tiling Shell's
// tilingManager drag handling by Domenico Ferraro (GPL-3.0-or-later).

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {SignalManager} from '../../shared/signals.js';
import {getWorkAreaForMonitor} from '../../shared/workarea.js';
import {log} from '../../shared/logger.js';
import {allTiles, tileAtPoint, tileToRect, tileWindowRect, unionTiles} from './layouts.js';
import {TilePreview} from './preview.js';
import {EdgeTiling} from './edgeTiling.js';
import {maximizeWindow} from './wmutils.js';

const RESTORE_DISTANCE = 90;
const OVERLAY_OPACITY = 40;

const MODIFIER_MASKS = {
    ctrl: Clutter.ModifierType.CONTROL_MASK,
    alt: Clutter.ModifierType.MOD1_MASK,
    super: Clutter.ModifierType.SUPER_MASK,
};

export class DragTiling {
    constructor(settings, signals) {
        this._settings = settings;   // ModuleSettings
        this._signals = signals;     // module SignalManager (global connections)
        this._grabSignals = new SignalManager();
        this._grabWindow = null;
        this._grabStart = null;
        this._pendingTile = null;
        this._pendingMaximize = false;
        this._preview = null;
        this._overlay = null;
        this._overlayTiles = [];
        this._edgeTiling = new EdgeTiling();
    }

    enable() {
        this._preview = new TilePreview();
        global.windowGroup.add_child(this._preview);
        this._overlay = new St.Widget({reactive: false, visible: false});
        global.windowGroup.add_child(this._overlay);
        this._signals.connect(global.display, 'grab-op-begin',
            (_display, window, grabOp) => {
                // Strip modifier flags (cf. upstream (grabOp & ~1024) === 1).
                const op = grabOp & ~1024;
                const moving = op === Meta.GrabOp.MOVING ||
                    op === Meta.GrabOp.KEYBOARD_MOVING;
                if (!moving)
                    return;
                this._onGrabBegin(window);
            });
        this._signals.connect(global.display, 'grab-op-end',
            (_display, window) => {
                if (window === this._grabWindow)
                    this._onGrabEnd(window);
            });
        log('Drag tiling enabled');
    }

    disable() {
        this._endGrab();
        this._grabSignals.disconnectAll();
        this._overlayTiles = [];
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        if (this._preview) {
            this._preview.destroy();
            this._preview = null;
        }
    }

    _innerGaps() {
        return this._settings.getInt('tiling-inner-gaps');
    }

    _outerGaps() {
        return this._settings.getInt('tiling-outer-gaps');
    }

    _isTileable(window) {
        return window &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.is_fullscreen() &&
            window.allows_resize() &&
            window.allows_move();
    }

    _keyActive(modifier, key) {
        if (key === 'none')
            return true;
        const mask = MODIFIER_MASKS[key];
        return mask !== undefined && (modifier & mask) === mask;
    }

    _tilingSystemActive(modifier) {
        if (!this._settings.getBoolean('tiling-tiling-system'))
            return false;
        const activated = this._keyActive(modifier,
            this._settings.getString('tiling-activation-key'));
        // 'none' means "no deactivation key": never deactivated (upstream:
        // deactivationKey === NONE ? false : keyActive). _keyActive('none')
        // is true (no key required), which is only correct for activation.
        const deactivationKey =
            this._settings.getString('tiling-deactivation-key');
        const deactivated = deactivationKey === 'none'
            ? false
            : this._keyActive(modifier, deactivationKey);
        return activated && !deactivated;
    }

    _onGrabBegin(window) {
        if (this._grabWindow || !this._isTileable(window))
            return;
        if (!this._settings.getBoolean('tiling-tiling-system') &&
            !this._settings.getBoolean('tiling-active-screen-edges'))
            return;
        this._grabWindow = window;
        this._grabSignals.connect(window, 'position-changed',
            () => this._onWindowMoved());
        this._grabSignals.connect(window, 'unmanaged', () => this._endGrab());
        this._onWindowMoved();
    }

    _onWindowMoved() {
        const window = this._grabWindow;
        if (!window)
            return;
        const workArea = getWorkAreaForMonitor(window.get_monitor());
        const [x, y, modifier] = global.get_pointer();
        if (!this._grabStart)
            this._grabStart = {x, y};
        this._maybeRestoreOriginalSize(window, x, y);
        if (this._tilingSystemActive(modifier)) {
            this._showLayoutOverlay(workArea);
            let tile = tileAtPoint(allTiles(), workArea, x, y);
            const span = this._settings.getBoolean('tiling-span-multiple-tiles') &&
                this._keyActive(modifier,
                    this._settings.getString('tiling-span-multiple-tiles-key'));
            if (tile && span && this._pendingTile)
                tile = unionTiles(this._pendingTile, tile);
            this._pendingTile = tile;
            this._pendingMaximize = false;
            if (tile)
                this._showPreview(window, tileWindowRect(tile, workArea,
                    this._innerGaps(), this._outerGaps()));
            else
                this._preview.hidePreview();
        } else {
            this._hideLayoutOverlay();
            this._updateEdgeTiling(window, workArea, x, y);
        }
    }

    _maybeRestoreOriginalSize(window, x, y) {
        if (!window.assignedTile || !window.originalSize || !this._grabStart)
            return;
        const dx = x - this._grabStart.x;
        const dy = y - this._grabStart.y;
        if (dx * dx + dy * dy <= RESTORE_DISTANCE * RESTORE_DISTANCE)
            return;
        if (this._settings.getBoolean('tiling-restore-window-size')) {
            const rect = window.get_frame_rect();
            const original = window.originalSize;
            const offsetX = rect.width > 0 ? (x - rect.x) / rect.width : 0.5;
            const offsetY = rect.height > 0 ? (y - rect.y) / rect.height : 0.5;
            window.move_resize_frame(false,
                Math.round(x - original.width * offsetX),
                Math.round(y - original.height * offsetY),
                original.width, original.height);
        }
        window.assignedTile = undefined;
        window.originalSize = undefined;
        this._grabStart = null;
    }

    _updateEdgeTiling(window, workArea, x, y) {
        this._pendingTile = null;
        this._pendingMaximize = false;
        if (!this._settings.getBoolean('tiling-active-screen-edges')) {
            this._preview.hidePreview();
            return;
        }
        const edge = this._edgeTiling.update(x, y, workArea, {
            offset: this._settings.getInt('tiling-edge-tiling-offset'),
            quarterArea: this._settings.getInt('tiling-quarter-tiling-activation-area'),
            topMaximize: this._settings.getBoolean('tiling-top-edge-maximize'),
        });
        if (!edge) {
            this._preview.hidePreview();
            return;
        }
        if (edge.kind === 'maximize') {
            this._pendingMaximize = true;
            this._showPreview(window, {
                x: workArea.x, y: workArea.y,
                width: workArea.width, height: workArea.height,
            });
        } else {
            this._pendingTile = edge.tile;
            this._showPreview(window, tileWindowRect(edge.tile, workArea,
                this._innerGaps(), this._outerGaps()));
        }
    }

    _onGrabEnd(window) {
        const tile = this._pendingTile;
        const maximize = this._pendingMaximize;
        this._endGrab();
        if (maximize) {
            if (window.can_maximize())
                maximizeWindow(window);
            return;
        }
        if (!tile)
            return;
        const workArea = getWorkAreaForMonitor(window.get_monitor());
        window.originalSize = window.get_frame_rect().copy();
        window.assignedTile = {...tile};
        const rect = tileWindowRect(tile, workArea,
            this._innerGaps(), this._outerGaps());
        window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
    }

    _endGrab() {
        this._grabWindow = null;
        this._grabStart = null;
        this._pendingTile = null;
        this._pendingMaximize = false;
        this._grabSignals.disconnectAll();
        this._hideLayoutOverlay();
        this._preview?.hidePreview();
    }

    _showPreview(window, rect) {
        const actor = window.get_compositor_private();
        if (actor)
            global.windowGroup.set_child_above_sibling(this._preview, actor);
        this._preview.showRect(rect);
    }

    _showLayoutOverlay(workArea) {
        const tiles = allTiles();
        while (this._overlayTiles.length < tiles.length) {
            const widget = new St.Widget({
                reactive: false,
                opacity: OVERLAY_OPACITY,
                style: 'background-color: rgba(120, 170, 255, 1);' +
                    'border-radius: 8px;',
            });
            this._overlay.add_child(widget);
            this._overlayTiles.push(widget);
        }
        tiles.forEach((tile, i) => {
            const rect = tileToRect(tile, workArea);
            const widget = this._overlayTiles[i];
            widget.set_position(rect.x, rect.y);
            widget.set_size(rect.width, rect.height);
            widget.show();
        });
        for (let i = tiles.length; i < this._overlayTiles.length; i++)
            this._overlayTiles[i].hide();
        this._overlay.show();
    }

    _hideLayoutOverlay() {
        this._overlay?.hide();
    }
}
