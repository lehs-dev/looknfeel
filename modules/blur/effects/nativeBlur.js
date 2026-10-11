import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';

export const NativeBlurEffect = GObject.registerClass({
    GTypeName: 'LooknFeelNativeBlurEffect',
}, class NativeBlurEffect extends Shell.BlurEffect {
    constructor(params = {}) {
        // BACKGROUND = làm mờ những gì NẰM SAU actor (đúng cho panel trong suốt)
        // ACTOR = làm mờ chính nội dung actor (dùng cho overview... để sau)
        super({mode: Shell.BlurMode.BACKGROUND});

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        // connectObject: tự ngắt khi effect bị destroy, không cần SignalManager
        this._themeContext.connectObject(
            'notify::scale-factor',
            () => { this.radius = Math.max(1, this._unscaledRadius * this._themeContext.scale_factor); },
            this);

        this._unscaledRadius = params.radius ?? 30;
        this.brightness = params.brightness ?? 0.6;
        this.radius = Math.max(1, this._unscaledRadius * this._themeContext.scale_factor);
    }
});
