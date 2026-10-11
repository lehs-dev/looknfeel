// Tiling module: drag-to-tile with activation key, edge tiling, tile
// keybindings (Super+arrows), directional/cyclic focus, resize
// complementing, and window-menu tile entries. Lean port of Tiling Shell by
// Domenico Ferraro (GPL-3.0-or-later).

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalManager} from '../../shared/signals.js';
import {ModuleSettings} from '../../shared/settings.js';
import {log} from '../../shared/logger.js';

import {KeybindingManager} from './keybindings.js';
import {DragTiling} from './dragTiling.js';
import {ResizeComplementing} from './resize.js';
import {WindowMenuOverride} from './windowMenu.js';
import {allTiles, findTileInDirection, tilesEqual, tileWindowRect} from './layouts.js';
import {maximizeWindow, unmaximizeWindow} from './wmutils.js';

const DISPLAY_DIRECTIONS = {
    left: Meta.DisplayDirection.LEFT,
    right: Meta.DisplayDirection.RIGHT,
    up: Meta.DisplayDirection.UP,
    down: Meta.DisplayDirection.DOWN,
};

export class TilingModule {
    constructor(settings /* raw Gio.Settings */) {
        this._rawSettings = settings;
        this._settings = null;
        this._signals = null;
        this._keybindings = null;
        this._dragTiling = null;
        this._resize = null;
        this._windowMenu = null;
        this._mutterSettings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._mutterEdgeTilingOriginal = null;
    }

    enable() {
        this._settings = new ModuleSettings(this._rawSettings);
        this._signals = new SignalManager();
        // Register the toggle first so flipping it in prefs always works.
        this._settings.onChanged('tiling-enabled', () => this._reload());
        if (!this._settings.getBoolean('tiling-enabled')) {
            log('Tiling module disabled by setting, skipping');
            return;
        }
        this._dragTiling = new DragTiling(this._settings, this._signals);
        this._dragTiling.enable();
        this._resize = new ResizeComplementing(this._settings, this._signals);
        this._resize.enable();
        this._windowMenu = new WindowMenuOverride(
            (tile, window) => this._tileWindowFromMenu(tile, window));
        this._settings.onChanged('tiling-window-menu-buttons',
            () => this._applyWindowMenu());
        this._applyWindowMenu();
        this._keybindings = new KeybindingManager(this._rawSettings);
        this._settings.onChanged('tiling-enable-keybindings',
            () => this._applyKeybindings());
        this._applyKeybindings();
        this._settings.onChanged('tiling-active-screen-edges',
            () => this._applyMutterEdgeTiling());
        this._applyMutterEdgeTiling();
        log('Tiling module enabled');
    }

    disable() {
        this._dragTiling?.disable();
        this._dragTiling = null;
        this._resize?.disable();
        this._resize = null;
        this._windowMenu?.disable();
        this._windowMenu = null;
        this._keybindings?.disable();
        this._keybindings = null;
        if (this._mutterEdgeTilingOriginal !== null) {
            this._mutterSettings.set_boolean('edge-tiling',
                this._mutterEdgeTilingOriginal);
            this._mutterEdgeTilingOriginal = null;
        }
        this._signals?.disconnectAll();
        this._signals = null;
        this._settings?.destroy();
        this._settings = null;
    }

    _reload() {
        this.disable();
        this.enable();
    }

    _innerGaps() {
        return this._settings.getInt('tiling-inner-gaps');
    }

    _outerGaps() {
        return this._settings.getInt('tiling-outer-gaps');
    }

    _applyKeybindings() {
        if (this._settings.getBoolean('tiling-enable-keybindings')) {
            this._keybindings.enable({
                move: dir => this._onKeyboardMove(dir),
                untile: () => this._onKeyboardUntile(),
                focusNext: () => this._onFocusNext(),
                focusPrev: () => this._onFocusPrev(),
                focusDirection: dir => this._onFocusDirection(dir),
            });
        } else {
            this._keybindings.disable();
        }
    }

    _applyWindowMenu() {
        if (this._settings.getBoolean('tiling-window-menu-buttons'))
            this._windowMenu.enable();
        else
            this._windowMenu.disable();
    }

    // Our edge tiling replaces mutter's; restore mutter's value on disable.
    _applyMutterEdgeTiling() {
        if (this._mutterEdgeTilingOriginal === null)
            this._mutterEdgeTilingOriginal =
                this._mutterSettings.get_boolean('edge-tiling');
        this._mutterSettings.set_boolean('edge-tiling',
            !this._settings.getBoolean('tiling-active-screen-edges'));
    }

    _tileWindow(window, tile, workArea, monitorIndex) {
        const maximized = window.maximizedHorizontally ||
            window.maximizedVertically;
        if (maximized)
            unmaximizeWindow(window);
        if (window.assignedTile === undefined && !maximized)
            window.originalSize = window.get_frame_rect().copy();
        window.assignedTile = {...tile};
        const rect = tileWindowRect(tile, workArea,
            this._innerGaps(), this._outerGaps());
        if (monitorIndex !== window.get_monitor())
            window.move_to_monitor(monitorIndex);
        window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
    }

    _tileWindowFromMenu(tile, window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL ||
            window.is_fullscreen())
            return;
        const monitor = window.get_monitor();
        this._tileWindow(window, tile,
            Main.layoutManager.getWorkAreaForMonitor(monitor), monitor);
    }

    _onKeyboardMove(direction) {
        const window = global.display.get_focus_window();
        if (!window || !window.has_focus() || window.is_fullscreen())
            return;
        const maximized = window.maximizedHorizontally ||
            window.maximizedVertically;
        if (maximized && direction === 'down') {
            unmaximizeWindow(window);
            return;
        }
        if (maximized && direction === 'up')
            return;
        if (direction === 'up' && window.assignedTile !== undefined &&
            window.assignedTile.y === 0) {
            if (window.can_maximize())
                maximizeWindow(window);
            return;
        }
        const monitor = window.get_monitor();
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const tile = findTileInDirection(allTiles(), workArea,
            window.get_frame_rect(), direction);
        if (!tile) {
            const neighbor = global.display.get_monitor_neighbor_index(
                monitor, DISPLAY_DIRECTIONS[direction]);
            if (neighbor === -1) {
                if (direction === 'up' && window.can_maximize())
                    maximizeWindow(window);
                return;
            }
            const neighborWorkArea =
                Main.layoutManager.getWorkAreaForMonitor(neighbor);
            const neighborTile = findTileInDirection(allTiles(),
                neighborWorkArea, window.get_frame_rect(), direction) ??
                allTiles()[0];
            this._tileWindow(window, neighborTile, neighborWorkArea, neighbor);
            return;
        }
        if (window.assignedTile !== undefined && tilesEqual(window.assignedTile, tile))
            return;
        this._tileWindow(window, tile, workArea, monitor);
    }

    _onKeyboardUntile() {
        const window = global.display.get_focus_window();
        if (!window || !window.has_focus() ||
            window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        if (window.maximizedHorizontally || window.maximizedVertically)
            unmaximizeWindow(window);
        if (!window.originalSize)
            return;
        const rect = window.originalSize;
        window.assignedTile = undefined;
        window.originalSize = undefined;
        window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
    }

    _focusableWindows() {
        const workspace = global.workspaceManager.get_active_workspace();
        const seen = new Set();
        const result = [];
        for (const win of workspace.list_windows()) {
            const w = win.is_attached_dialog() && win.get_transient_for()
                ? win.get_transient_for() : win;
            if (!w || w.skip_taskbar || seen.has(w))
                continue;
            seen.add(w);
            result.push(w);
        }
        return result;
    }

    _onFocusNext() {
        const windows = this._focusableWindows();
        const focusWindow = global.display.get_focus_window();
        if (!focusWindow)
            return;
        const focusParent = focusWindow.get_transient_for() || focusWindow;
        const idx = windows.indexOf(focusParent);
        if (idx < 0 || windows.length === 0)
            return;
        const next = (idx + 1) % windows.length;
        if (next !== 0 || this._settings.getBoolean('tiling-focus-wraparound'))
            windows[next].activate(global.get_current_time());
    }

    _onFocusPrev() {
        const windows = this._focusableWindows();
        const focusWindow = global.display.get_focus_window();
        if (!focusWindow)
            return;
        const focusParent = focusWindow.get_transient_for() || focusWindow;
        const idx = windows.indexOf(focusParent);
        if (idx < 0 || windows.length === 0)
            return;
        if (idx === 0) {
            if (this._settings.getBoolean('tiling-focus-wraparound'))
                windows[windows.length - 1].activate(global.get_current_time());
        } else {
            windows[idx - 1].activate(global.get_current_time());
        }
    }

    _onFocusDirection(direction) {
        const focusWindow = global.display.get_focus_window();
        if (!focusWindow || !focusWindow.has_focus())
            return;
        const rect = focusWindow.get_frame_rect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const onlyTiled = this._settings.getBoolean(
            'tiling-restrict-directional-focus-to-tiled');
        let best = null;
        let bestDist = -1;
        for (const win of this._focusableWindows()) {
            if (win === focusWindow || win.minimized)
                continue;
            if (onlyTiled && win.assignedTile === undefined)
                continue;
            const r = win.get_frame_rect();
            const inDirection =
                direction === 'right' ? r.x > rect.x :
                direction === 'left' ? r.x < rect.x :
                direction === 'up' ? r.y < rect.y :
                direction === 'down' ? r.y > rect.y : false;
            if (!inDirection)
                continue;
            const wx = r.x + r.width / 2;
            const wy = r.y + r.height / 2;
            const dist = (wx - cx) * (wx - cx) + (wy - cy) * (wy - cy);
            if (!best || dist < bestDist) {
                best = win;
                bestDist = dist;
            }
        }
        if (best)
            best.activate(global.get_current_time());
    }
}
