// Every GNOME Shell version-fragile Dash access is isolated here behind
// try/catch fallbacks, so a Shell update can only break in one place.
// Covers GNOME 50/51 only.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import St from 'gi://St';

export function getDashBox(dash) {
    try {
        return dash._box ?? null;
    } catch {
        return null;
    }
}

export function hideDashBackground(dash) {
    try {
        if (dash._background)
            dash._background.visible = false;
    } catch {
        /* already gone */
    }
}

export function hideShowAppsIcon(dash) {
    try {
        if (dash._showAppsIcon)
            dash._showAppsIcon.visible = false;
    } catch {
        /* already gone */
    }
}

export function getAppwellDot(appwell) {
    try {
        return appwell._dot ?? null;
    } catch {
        return null;
    }
}

export function getContainerLabel(container) {
    try {
        return container.label ?? null;
    } catch {
        return null;
    }
}

// Walk DashIcon -> BaseIcon -> St.Icon (GNOME 50 structure).
export function getStIconFromAppwell(appwell) {
    try {
        const base = appwell?.icon;
        if (!base)
            return null;
        if (base instanceof St.Icon)
            return base;
        if (base.icon instanceof St.Icon)
            return base.icon;
        const binChild = base._iconBin?.child;
        if (binChild instanceof St.Icon)
            return binChild;
        // Force icon creation when it hasn't happened yet.
        if (typeof base._createIconTexture === 'function') {
            base._createIconTexture(48);
            if (base.icon instanceof St.Icon)
                return base.icon;
        }
    } catch {
        /* ignore */
    }
    return null;
}

// Stop the Dash from managing icon sizes itself, and hide newly created
// items immediately — the animator draws its own magnified copies in the
// render area, so the originals must never be visible.
export function patchDash(dash) {
    try {
        dash._adjustIconSize = () => {};
    } catch {
        /* ignore */
    }
    try {
        const orig = dash._createAppItem.bind(dash);
        dash._createAppItem = function (app) {
            const item = orig(app);
            try {
                item.child.visible = false;
            } catch {
                /* ignore */
            }
            return item;
        };
    } catch {
        /* ignore */
    }
    // Items may already exist (created during `new Dash()`).
    try {
        for (const child of getDashBox(dash)?.get_children() ?? []) {
            try {
                if (child.child)
                    child.child.visible = false;
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
}

export function getFavoriteIds() {
    try {
        const favs = AppFavorites.getAppFavorites();
        if (typeof favs.getIds === 'function')
            return favs.getIds();
        if (typeof favs._getIds === 'function')
            return favs._getIds();
    } catch {
        /* ignore */
    }
    return [];
}
