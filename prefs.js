// LooknFeel preferences window: Blur / Dock / Tweaks pages.
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

function _entryRow(settings, key, title, subtitle = '') {
    const row = new Adw.EntryRow({title, subtitle});
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
        this._tweaksPage(window, settings);
    }

    _blurPage(window, s) {
        const page = new Adw.PreferencesPage({title: 'Blur', icon_name: 'blur-symbolic'});
        _group(page, 'General', [
            _switchRow(s, 'blur-enabled', 'Enable blur effects'),
        ]);
        _group(page, 'Top panel', [
            _switchRow(s, 'blur-panel-enabled', 'Blur the top panel'),
            _intSpinRow(s, 'blur-panel-radius', 'Blur radius', '', 1, 100, 1),
            _doubleSpinRow(s, 'blur-panel-brightness', 'Blur brightness', '', 0, 1, 0.05),
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
            _comboRow(s, 'tweaks-top-panel-position', 'Panel position', '', ['Top', 'Bottom']),
            _intSpinRow(s, 'tweaks-panel-size', 'Panel height', 'Pixels, 0 = automatic', 0, 64, 1),
            _comboRow(s, 'tweaks-clock-menu-position', 'Clock position', '', ['Center', 'Right', 'Left']),
            _intSpinRow(s, 'tweaks-clock-menu-position-offset', 'Clock offset', '', 0, 8, 1),
        ]);
        _group(page, 'Overview & search', [
            _switchRow(s, 'tweaks-search', 'Search entry'),
            _switchRow(s, 'tweaks-type-to-search', 'Type to search'),
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
        ]);
        _group(page, 'Notifications & OSD', [
            _switchRow(s, 'tweaks-osd', 'On-screen display', 'Volume/brightness popups'),
            _intSpinRow(s, 'tweaks-osd-position', 'OSD position',
                '0 = default, 1-8 = 3x3 grid (1 = top center)', 0, 8, 1),
            _intSpinRow(s, 'tweaks-notification-banner-position', 'Banner position',
                '3x3 grid, 1 = top center', 0, 8, 1),
            _switchRow(s, 'tweaks-ripple-box', 'Unlock ripple animation'),
            _switchRow(s, 'tweaks-overlay-key', 'Super key opens overview'),
        ]);
        window.add(page);
    }
}
