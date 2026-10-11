import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {BlurModule} from './modules/blur/blurManager.js';
import {DockModule} from './modules/dock/dock.js';
import {TweaksModule} from './modules/tweaks/tweaks.js';
import {GapModule} from './modules/gap/gap.js';
import {TilingModule} from './modules/tiling/tiling.js';
import {SearchModule} from './modules/search/searchModule.js';
import {LampModule} from './modules/lamp/lampModule.js';
import {KimpanelModule} from './modules/kimpanel/kimpanelModule.js';
import {WsbgModule} from './modules/wsbg/wsbg.js';
import {LightStyleModule} from './modules/lightstyle/lightstyle.js';

export default class LooknFeelExtension extends Extension{
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.looknfeel');
        const blurModule = new BlurModule(this._settings);
        this._modules = [
            blurModule,
            new DockModule(this._settings, blurModule),
            new GapModule(this._settings),
            new TilingModule(this._settings),
            new SearchModule(this._settings),
            new LampModule(this._settings),
            new TweaksModule(this._settings),
            new KimpanelModule(this._settings),
            new WsbgModule(this._settings),
            new LightStyleModule(this._settings),
        ];
        for (const module of this._modules) module.enable();
    }

    disable() {
        for (const module of (this._modules ?? []).toReversed()) module.disable();
        this._modules = [];
        this._settings = null;
    }
}
