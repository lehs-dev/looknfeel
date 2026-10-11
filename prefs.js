// LooknFeel preferences window: Blur / Dock / Tiling / Search / Gaps / Lamp /
// Tweaks / Input Method / Workspace / Style pages.
// Data-driven rows bound directly to GSettings keys.

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

const SCHEMA = 'org.gnome.shell.extensions.looknfeel';

function _switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function _doubleSpinRow(settings, key, title, subtitle, min, max, step) {
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({
            lower: min, upper: max, step_increment: step, page_increment: step * 10,
        }),
        digits: 2,
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function _intSpinRow(settings, key, title, subtitle, min, max, step) {
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({
            lower: min, upper: max, step_increment: step, page_increment: step * 10,
        }),
        digits: 0,
    });
    // Manual two-way sync: SpinRow 'value' is a double but the key is an
    // int, and Gio.Settings.bind_with_mapping's callback convention is not
    // reliable across GJS versions — this is bulletproof instead.
    const adj = row.get_adjustment();
    adj.set_value(settings.get_int(key));
    adj.connect('value-changed', () => {
        settings.set_int(key, Math.round(adj.get_value()));
    });
    const changedId = settings.connect(`changed::${key}`, () => {
        const v = settings.get_int(key);
        if (Math.round(adj.get_value()) !== v)
            adj.set_value(v);
    });
    row.connect('destroy', () => {
        try {
            settings.disconnect(changedId);
        } catch {
            /* already gone */
        }
    });
    return row;
}

function _comboRow(settings, key, title, subtitle, options) {
    const row = new Adw.ComboRow({
        title, subtitle,
        model: new Gtk.StringList({strings: options}),
    });
    settings.bind(key, row, 'selected', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// ComboRow for string-valued keys: manual index <-> string mapping.
function _stringComboRow(settings, key, title, subtitle, options) {
    const row = new Adw.ComboRow({
        title, subtitle,
        model: new Gtk.StringList({strings: options}),
    });
    const syncFromSettings = () => {
        const idx = options.indexOf(settings.get_string(key));
        row.set_selected(idx >= 0 ? idx : 0);
    };
    syncFromSettings();
    row.connect('notify::selected', () => {
        const value = options[row.get_selected()];
        if (value !== undefined && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    const changedId = settings.connect(`changed::${key}`, syncFromSettings);
    row.connect('destroy', () => {
        try {
            settings.disconnect(changedId);
        } catch {
            /* already gone */
        }
    });
    return row;
}

// Read-only display of a keybinding. strv=true for 'as' keys holding a list,
// false for plain string keys holding a single accelerator.
function _keybindingRow(settings, key, title, subtitle = '', strv = true) {
    const row = new Adw.ActionRow({title, subtitle});
    const label = new Gtk.Label({css_classes: ['dim-label']});
    row.add_suffix(label);
    const sync = () => {
        const accels = strv
            ? settings.get_strv(key).filter(a => a.length > 0)
            : [settings.get_string(key)].filter(a => a.length > 0);
        label.set_text(accels.length ? accels.join(', ') : 'Disabled');
    };
    sync();
    const changedId = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => {
        try {
            settings.disconnect(changedId);
        } catch {
            /* already gone */
        }
    });
    return row;
}

function _entryRow(settings, key, title, subtitle = '') {
    // AdwEntryRow has no subtitle property; show the hint as a tooltip.
    const row = new Adw.EntryRow({ title });
    if (subtitle)
        row.set_tooltip_text(subtitle);
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function _group(page, title, rows) {
    const group = new Adw.PreferencesGroup({title});
    for (const row of rows)
        group.add(row);
    page.add(group);
}

export default class LooknFeelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA);
        this._blurPage(window, settings);
        this._dockPage(window, settings);
        this._tilingPage(window, settings);
        this._searchPage(window, settings);
        this._gapPage(window, settings);
        this._lampPage(window, settings);
        this._tweaksPage(window, settings);
        this._kimpanelPage(window, settings);
        this._wsbgPage(window, settings);
        this._lightstylePage(window, settings);
    }

    _blurPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Blur', icon_name: 'blur-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'blur-enabled', 'Enable blur effects'),
        ]);
        _group(page, 'Top panel', [
            _switchRow(s, 'blur-panel-enabled', 'Blur the top panel'),
            _switchRow(s, 'blur-panel-override-background', 'Transparent panel background',
                'Remove the panel background so the blur shows through'),
            _switchRow(s, 'blur-panel-disable-in-overview', 'Disable in overview'),
            _intSpinRow(s, 'blur-panel-radius', 'Blur radius', '', 0, 100, 1),
            _doubleSpinRow(s, 'blur-panel-brightness', 'Blur brightness', '', 0, 1, 0.05),
        ]);
        _group(page, 'Lock screen', [
            _switchRow(s, 'blur-lockscreen-enabled', 'Blur the lock screen'),
        ]);
        window.add(page);
    }

    _dockPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Dock', icon_name: 'view-app-grid-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'dock-enabled', 'Enable the dock'),
            _comboRow(s, 'dock-location', 'Position', '',
                ['Bottom', 'Left', 'Right', 'Top']),
            _comboRow(s, 'dock-multi-monitor', 'Show on', '',
                ['Primary monitor', 'All monitors']),
            _switchRow(s, 'dock-panel-mode', 'Panel mode',
                'Stretch the background across the whole screen edge'),
            _switchRow(s, 'lamp-enabled', 'Lamp animation on minimize',
                'Genie effect when minimizing windows'),
        ]);
        _group(page, 'Behavior', [
            _switchRow(s, 'dock-autohide', 'Autohide',
                'Hide the dock, reveal by touching the screen edge'),
            _switchRow(s, 'dock-dodge-windows', 'Dodge windows',
                'Hide the dock when a window overlaps it'),
            _switchRow(s, 'dock-pressure-sense', 'Pressure sense',
                'Only the outermost screen-edge pixel reveals a hidden dock'),
            _switchRow(s, 'dock-bounce-on-launch', 'Bounce on launch'),
            _switchRow(s, 'dock-favorites-only', 'Favorites only'),
        ]);
        _group(page, 'Icons', [
            _switchRow(s, 'dock-show-trash', 'Show trash'),
            _switchRow(s, 'dock-show-mounts', 'Show mounted volumes'),
            _switchRow(s, 'dock-show-apps-icon', 'Show applications icon'),
        ]);
        _group(page, 'Appearance', [
            _doubleSpinRow(s, 'dock-icon-size', 'Icon size', '', 0.5, 2, 0.05),
            _doubleSpinRow(s, 'dock-icon-spacing', 'Icon spacing', '', 0, 1, 0.05),
            _doubleSpinRow(s, 'dock-edge-distance', 'Edge distance', 'Distance from the screen edge, in px', 0, 64, 1),
            _entryRow(s, 'dock-background-color', 'Background color', 'CSS color, e.g. rgba(20,20,25,0.65)'),
            _intSpinRow(s, 'dock-border-radius', 'Corner radius', '', 0, 40, 1),
            _switchRow(s, 'dock-blur-background', 'Blur background'),
            _intSpinRow(s, 'dock-blur-radius', 'Blur radius', '', 1, 100, 1),
            _doubleSpinRow(s, 'dock-blur-brightness', 'Blur brightness', '', 0, 1, 0.05),
            _comboRow(s, 'dock-running-indicator-style', 'Running indicator', '',
                ['Dots', 'Dot', 'Dashes', 'Dash', 'Squares', 'Square',
                 'Segmented', 'Solid', 'Triangles', 'Triangle',
                 'Diamonds', 'Diamond', 'Binary']),
        ]);
        _group(page, 'Animation', [
            _switchRow(s, 'dock-animate', 'Animate on hover', 'macOS-style magnification'),
            _doubleSpinRow(s, 'dock-magnify', 'Magnification', '', 0, 1, 0.05),
            _doubleSpinRow(s, 'dock-spread', 'Spread', 'How much icons push their neighbors', 0, 1, 0.05),
            _doubleSpinRow(s, 'dock-rise', 'Rise', 'How much icons lift off the dock', 0, 1, 0.05),
            _comboRow(s, 'dock-rise-curve', 'Easing curve', '', ['Quadratic', 'Cubic']),
        ]);
        window.add(page);
    }

    _tweaksPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Tweaks', icon_name: 'preferences-system-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'tweaks-enabled', 'Enable UI tweaks'),
        ]);
        _group(page, 'Top panel', [
            _switchRow(s, 'tweaks-activities-button', 'Activities button'),
            _switchRow(s, 'tweaks-clock-menu', 'Clock menu'),
            _switchRow(s, 'tweaks-keyboard-layout', 'Keyboard layout indicator'),
            _switchRow(s, 'tweaks-accessibility-menu', 'Accessibility menu'),
            _switchRow(s, 'tweaks-quick-settings', 'Quick settings menu'),
            _switchRow(s, 'tweaks-panel', 'Show panel', 'Turn off to hide the whole top panel'),
            _switchRow(s, 'tweaks-panel-in-overview', 'Show in overview'),
            _switchRow(s, 'tweaks-screen-sharing-indicator', 'Screen sharing indicator'),
            _switchRow(s, 'tweaks-screen-recording-indicator', 'Screen recording indicator'),
            _switchRow(s, 'tweaks-panel-notification-icon', 'Notification icon'),
            _switchRow(s, 'tweaks-power-icon', 'Power indicator'),
            _comboRow(s, 'tweaks-top-panel-position', 'Panel position', '', ['Top', 'Bottom']),
            _intSpinRow(s, 'tweaks-panel-size', 'Panel height', 'Pixels, 0 = automatic', 0, 64, 1),
            _comboRow(s, 'tweaks-clock-menu-position', 'Clock position', '', ['Center', 'Right', 'Left']),
            _intSpinRow(s, 'tweaks-clock-menu-position-offset', 'Clock offset', '', 0, 8, 1),
        ]);
        _group(page, 'Quick settings toggles', [
            _switchRow(s, 'tweaks-quick-settings-dark-mode', 'Dark mode'),
            _switchRow(s, 'tweaks-quick-settings-backlight', 'Backlight'),
            _switchRow(s, 'tweaks-quick-settings-dnd', 'Do not disturb'),
            _switchRow(s, 'tweaks-quick-settings-night-light', 'Night light'),
            _switchRow(s, 'tweaks-quick-settings-airplane-mode', 'Airplane mode'),
        ]);
        _group(page, 'Clock menu', [
            _switchRow(s, 'tweaks-world-clock', 'World clocks'),
            _switchRow(s, 'tweaks-weather', 'Weather'),
            _switchRow(s, 'tweaks-calendar', 'Calendar'),
            _switchRow(s, 'tweaks-events', 'Events button'),
            _switchRow(s, 'tweaks-invert-calendar-column-items', 'Invert calendar columns',
                'Swap the positions of the calendar column items'),
        ]);
        _group(page, 'Menus', [
            _switchRow(s, 'tweaks-window-menu', 'Window menu',
                'Menu on title-bar right-click'),
            _switchRow(s, 'tweaks-background-menu', 'Background menu',
                'Menu on desktop right-click'),
        ]);
        _group(page, 'Overview & search', [
            _switchRow(s, 'tweaks-search', 'Search entry'),
            _switchRow(s, 'tweaks-type-to-search', 'Type to search'),
            _switchRow(s, 'tweaks-window-picker-icon', 'App icon under window previews'),
            _comboRow(s, 'tweaks-animation', 'Animation speed', '',
                ['Off', 'Default', 'Almost none', 'Fastest', 'Faster', 'Fast',
                 'Slow', 'Slower', 'Slowest']),
            _comboRow(s, 'tweaks-startup-status', 'Show on login', '', ['Desktop', 'Overview']),
        ]);
        _group(page, 'Windows', [
            _switchRow(s, 'tweaks-window-maximized-on-create', 'Maximize new windows'),
            _switchRow(s, 'tweaks-window-demands-attention-focus', 'Focus demanding windows',
                'Focus windows demanding attention instead of only marking them urgent'),
            _switchRow(s, 'tweaks-window-preview-caption', 'Window titles in overview'),
        ]);
        _group(page, 'Workspaces', [
            _switchRow(s, 'tweaks-workspace-wrap-around', 'Wrap around',
                'Wrap when switching past the first/last workspace'),
            _switchRow(s, 'tweaks-workspace-popup', 'Switcher popup'),
            _switchRow(s, 'tweaks-workspace-peek', 'Workspace peek',
                'Show the adjacent workspaces in overview'),
            _switchRow(s, 'tweaks-workspace-switcher-click-main-view',
                'Switcher click goes to main view'),
            _switchRow(s, 'tweaks-always-show-workspace-switcher',
                'Always show the switcher'),
        ]);
        _group(page, 'Notifications & OSD', [
            _switchRow(s, 'tweaks-osd', 'On-screen display', 'Volume/brightness popups'),
            _intSpinRow(s, 'tweaks-osd-position', 'OSD position',
                '0 = default, 1-8 = 3x3 grid (1 = top center)', 0, 8, 1),
            _intSpinRow(s, 'tweaks-notification-banner-position', 'Banner position',
                '3x3 grid, 1 = top center', 0, 8, 1),
            _switchRow(s, 'tweaks-ripple-box', 'Unlock ripple animation'),
            _switchRow(s, 'tweaks-overlay-key', 'Super key opens overview'),
            _switchRow(s, 'tweaks-double-super-to-app-grid', 'Double Super opens app grid'),
        ]);
        window.add(page);
    }

    _gapPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Gaps', icon_name: 'view-grid-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'gap-enabled', 'Enable window gaps',
                'Keep a margin between windows and the screen edges'),
            _switchRow(s, 'gap-same-on-all-edges', 'Same gap on all edges',
                'Use one size for top, bottom, left, and right'),
            _intSpinRow(s, 'gap-size', 'Gap size', 'Pixels of margin on every edge',
                0, 128, 1),
        ]);
        _group(page, 'Per-edge margins', [
            _intSpinRow(s, 'gap-top', 'Top', '', 0, 128, 1),
            _intSpinRow(s, 'gap-bottom', 'Bottom', '', 0, 128, 1),
            _intSpinRow(s, 'gap-left', 'Left', '', 0, 128, 1),
            _intSpinRow(s, 'gap-right', 'Right', '', 0, 128, 1),
        ]);
        window.add(page);
    }

    _tilingPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Tiling', icon_name: 'view-tiled-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'tiling-enabled', 'Enable tiling'),
            _switchRow(s, 'tiling-enable-keybindings', 'Use hotkeys',
                'Hotkeys to perform actions on the focused window'),
        ]);
        _group(page, 'Keybindings', [
            _keybindingRow(s, 'tiling-move-window-right', 'Move window to right tile'),
            _keybindingRow(s, 'tiling-move-window-left', 'Move window to left tile'),
            _keybindingRow(s, 'tiling-move-window-up', 'Move window to tile above'),
            _keybindingRow(s, 'tiling-move-window-down', 'Move window to tile below'),
            _switchRow(s, 'tiling-focus-wraparound', 'Focus wraps around',
                'When focusing next/previous window, wrap at the window edge'),
            _switchRow(s, 'tiling-restrict-directional-focus-to-tiled',
                'Directional focus only on tiled windows'),
        ]);
        _group(page, 'Drag tiling', [
            _switchRow(s, 'tiling-tiling-system', 'Enable tiling system',
                'Hold the activation key while moving a window to tile it'),
            _stringComboRow(s, 'tiling-activation-key', 'Activation key', '',
                ['none', 'ctrl', 'alt', 'super']),
            _stringComboRow(s, 'tiling-deactivation-key', 'Deactivation key',
                'Hold to suppress tiling while moving a window',
                ['none', 'ctrl', 'alt', 'super']),
            _switchRow(s, 'tiling-span-multiple-tiles', 'Span multiple tiles',
                'Hold the span key to span multiple tiles'),
            _stringComboRow(s, 'tiling-span-multiple-tiles-key', 'Span key', '',
                ['none', 'ctrl', 'alt', 'super']),
            _switchRow(s, 'tiling-auto-resize-complementing', 'Auto-resize neighbors',
                'When a tiled window is resized, resize the tiled windows near it'),
            _switchRow(s, 'tiling-restore-window-size', 'Restore window size',
                'Restore the original size when a window is untiled'),
            _switchRow(s, 'tiling-window-menu-buttons', 'Window menu buttons',
                'Add tile actions to the window menu'),
        ]);
        _group(page, 'Screen edges', [
            _switchRow(s, 'tiling-active-screen-edges', 'Enable screen edges',
                'Drag windows against screen edges to tile them'),
            _switchRow(s, 'tiling-top-edge-maximize', 'Top edge maximizes',
                'Drag against the top edge to maximize'),
            _intSpinRow(s, 'tiling-quarter-tiling-activation-area',
                'Quarter tiling activation area', '% of the screen', 0, 100, 1),
            _intSpinRow(s, 'tiling-edge-tiling-offset', 'Edge tiling offset',
                'Offset from the screen edge to trigger edge tiling, in px', 0, 64, 1),
        ]);
        _group(page, 'Gaps', [
            _intSpinRow(s, 'tiling-inner-gaps', 'Inner gaps',
                'Gaps between tiled windows, in px', 0, 64, 1),
            _intSpinRow(s, 'tiling-outer-gaps', 'Outer gaps',
                'Gaps between tiles and the work area edge, in px', 0, 64, 1),
        ]);
        window.add(page);
    }

    _searchPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Search', icon_name: 'system-search-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'search-enabled', 'Enable the search popup'),
            _keybindingRow(s, 'search-shortcut', 'Shortcut',
                'Keyboard shortcut to pop up the search box', false),
            _switchRow(s, 'search-popup-at-cursor-monitor', 'Popup at cursor monitor',
                'Show the search box on the monitor where the cursor is'),
            _intSpinRow(s, 'search-preferred-monitor', 'Preferred monitor',
                '0 = primary monitor', 0, 8, 1),
        ]);
        _group(page, 'Appearance', [
            _doubleSpinRow(s, 'search-window-scale', 'Width',
                'Window width as a fraction of the monitor width', 0.05, 0.5, 0.01),
            _intSpinRow(s, 'search-entry-font-size', 'Search text size',
                'Font size of the search input, in pt', 8, 32, 1),
            _switchRow(s, 'search-animations', 'Animations',
                'Enable fade-in/out animations'),
            _intSpinRow(s, 'search-animation-speed', 'Animation speed',
                'Lower is faster, in ms', 0, 1000, 10),
        ]);
        window.add(page);
    }

    _lampPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Lamp', icon_name: 'weather-clear-symbolic'});
        _group(page, 'Magic lamp effect', [
            _switchRow(s, 'lamp-enabled', 'Enable the lamp effect',
                'Genie animation when minimizing/unminimizing windows'),
            _stringComboRow(s, 'lamp-effect', 'Effect', '', ['default', 'sine']),
            _intSpinRow(s, 'lamp-duration-ms', 'Duration', 'In milliseconds',
                0, 2000, 10),
            _intSpinRow(s, 'lamp-x-tiles', 'X tiles', '', 1, 64, 1),
            _intSpinRow(s, 'lamp-y-tiles', 'Y tiles', '', 1, 64, 1),
        ]);
        window.add(page);
    }

    _kimpanelPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Input Method', icon_name: 'input-keyboard-symbolic'});
        _group(page, 'Candidate panel', [
            _switchRow(s, 'kimpanel-enabled', 'Enable the candidate panel',
                'Show input-method candidates near the cursor'),
            _switchRow(s, 'kimpanel-vertical-list', 'Vertical list'),
            _entryRow(s, 'kimpanel-font', 'Font', 'Pango font description'),
        ]);
        window.add(page);
    }

    _wsbgPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Workspace', icon_name: 'view-grid-symbolic'});
        _group(page, 'Background', [
            _switchRow(s, 'wsbg-enabled', 'Static workspace background',
                'Keep the wallpaper fixed instead of sliding during workspace switches'),
        ]);
        window.add(page);
    }

    _lightstylePage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Style', icon_name: 'applications-graphics-symbolic'});
        _group(page, 'Color scheme', [
            _switchRow(s, 'lightstyle-enabled', 'Light shell style',
                'Prefer the light color scheme for the panel, menus, and overview'),
        ]);
        window.add(page);
    }
}
