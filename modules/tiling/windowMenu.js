// Adds a "Move to tile" submenu to the window menu with one entry per tile
// (halves + quarters). Adapted from Tiling Shell's overriddenWindowMenu.js
// by Domenico Ferraro (GPL-3.0-or-later).

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as WindowMenu from 'resource:///org/gnome/shell/ui/windowMenu.js';

import {LAYOUTS} from './layouts.js';

const TILE_LABELS = {
    halves: ['Left half', 'Right half'],
    quarters: [
        'Top-left quarter', 'Top-right quarter',
        'Bottom-left quarter', 'Bottom-right quarter',
    ],
};

export class WindowMenuOverride {
    constructor(onTile) {
        this._onTile = onTile;   // (tile, window) =>
        this._original = null;
    }

    enable() {
        if (this._original)
            return;
        this._original = WindowMenu.WindowMenu.prototype._buildMenu;
        const self = this;
        WindowMenu.WindowMenu.prototype._buildMenu = function (window) {
            self._original.call(this, window);
            self._addTileItems(this, window);
        };
    }

    disable() {
        if (!this._original)
            return;
        WindowMenu.WindowMenu.prototype._buildMenu = this._original;
        this._original = null;
    }

    _addTileItems(menu, window) {
        const submenu = new PopupMenu.PopupSubMenuMenuItem('Move to tile');
        for (const layout of LAYOUTS) {
            layout.tiles.forEach((tile, i) => {
                const label = TILE_LABELS[layout.id][i];
                const item = new PopupMenu.PopupMenuItem(label);
                item.connect('activate', () => this._onTile(tile, window));
                submenu.menu.addMenuItem(item);
            });
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(submenu);
    }
}
