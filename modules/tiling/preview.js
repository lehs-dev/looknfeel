// Tile preview overlay: a single translucent rectangle shown where the
// window will land. Adapted from Tiling Shell's tilePreview.js by Domenico
// Ferraro (GPL-3.0-or-later).

import St from 'gi://St';

export class TilePreview extends St.Widget {
    constructor() {
        super({
            reactive: false,
            visible: false,
            style: 'background-color: rgba(70, 130, 220, 0.45);' +
                'border: 1px solid rgba(130, 185, 255, 0.9);' +
                'border-radius: 12px;',
        });
    }

    showRect(rect) {
        this.set_position(Math.round(rect.x), Math.round(rect.y));
        this.set_size(Math.round(rect.width), Math.round(rect.height));
        this.show();
    }

    hidePreview() {
        this.hide();
    }
}
