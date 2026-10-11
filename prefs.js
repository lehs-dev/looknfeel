import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export default class LooknFeelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.looknfeel');

        for (const [title, key] of [['Blur', 'blur-enabled'],
                                   ['Dock', 'dock-enabled'],
                                   ['Tweaks', 'tweaks-enabled']]) {
            const page = new Adw.PreferencesPage({title});
            const group = new Adw.PreferencesGroup({title});
            const row = new Adw.SwitchRow({title: `Enable ${title}`});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
            page.add(group);
            window.add(page);
        }
    }
}
