import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {BlurModule} from './modules/blur/blurManager.js';
import {DockModule} from './modules/dock/dock.js';
import {TweaksModule} from './modules/tweaks/tweaks.js';

export default class LooknFeelExtension extends Extension{
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.looknfeel');
        this._modules = [
            new BlurModule(this._settings),
            new DockModule(this._settings),
            new TweaksModule(this._settings),
        ];
        for (const module of this._modules) module.enable();   
    }

    disable() {
        for (const module of this._modules.toReversed()) module.disable();
        this._modules = [];
        this._settings = null;
    }
}