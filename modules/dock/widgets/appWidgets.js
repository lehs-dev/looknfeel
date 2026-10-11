// Match dock entries to the live app widgets (clock/calendar). Upstream
// dash2dock-lite matches on icon name; here the source St.Icon usually
// carries a GIcon, so compare its themed names with the same two ids.

const CLOCK_NAMES = ['org.gnome.clocks'];
const CALENDAR_NAMES = ['org.gnome.Calendar'];

function _iconNames(entry) {
    const src = entry?.icon;
    if (!src)
        return [];
    const names = src.gicon?.get_names?.();
    if (Array.isArray(names) && names.length)
        return names;
    return src.icon_name ? [src.icon_name] : [];
}

export function matchAppWidget(entry) {
    if (!entry || entry.custom)
        return null;
    const names = _iconNames(entry);
    if (names.some(n => CLOCK_NAMES.includes(n)))
        return 'clock';
    if (names.some(n => CALENDAR_NAMES.includes(n)))
        return 'calendar';
    return null;
}
