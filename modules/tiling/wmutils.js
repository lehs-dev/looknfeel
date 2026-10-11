// Window helpers. maximizeWindow/unmaximizeWindow adapted from Tiling
// Shell's utils/gnomesupport.js by Domenico Ferraro (GPL-3.0-or-later).

import Meta from 'gi://Meta';

export function maximizeWindow(window) {
    window.maximize(Meta.MaximizeFlags.BOTH);
}

export function unmaximizeWindow(window) {
    window.unmaximize(Meta.MaximizeFlags.BOTH);
}
