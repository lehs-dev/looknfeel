// Shared work-area lookup with a guard for stale monitor indexes
// (windows on a just-unplugged monitor report -1 until they move).
// Used by the tiling module; the gap module already shapes this area
// through its strut actors, so both compose instead of double-counting.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getWorkAreaForMonitor(index) {
    const monitors = Main.layoutManager.monitors;
    const fallback = monitors[Main.layoutManager.primaryIndex] ? Main.layoutManager.primaryIndex : 0;
    const safe = Number.isInteger(index) && monitors[index] ? index : fallback;
    return Main.layoutManager.getWorkAreaForMonitor(safe);
}
