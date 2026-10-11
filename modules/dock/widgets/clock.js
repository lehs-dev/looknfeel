// Live analog clock overlay for the Clocks app icon in the dock. Lean port
// of dash2dock-lite's apps/clock.js by icedman (GPL-2.0-or-later): default
// style only, fixed palette (no style dropdowns or theme-color settings).
// The widget replaces the app icon; redrawn only when the minute changes.

import Cairo from 'gi://cairo';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Drawing} from '../drawing.js';

const PALETTE = {
    dark_color: [0.2, 0.2, 0.2, 1.0],
    light_color: [1.0, 1.0, 1.0, 1.0],
    accent_color: [1.0, 0.0, 0.0, 1.0],
};

// Default-style (style 0) composition: bordered dark dial, accent hands,
// no frame or minute marks. Matches upstream's `case 0/default` branch.
function _defaultStyle(p) {
    return {
        hands: {hour: p.accent_color, minute: p.light_color},
        marks: null,
        dial: {
            size: 0.95,
            background: p.dark_color,
            border: p.light_color,
            borderWidth: 3,
        },
        frame: null,
    };
}

function _drawFrame(ctx, size, settings) {
    if (!settings.frame)
        return;
    const {background, border, borderWidth} = settings.frame;
    ctx.save();
    const bgSize = size * settings.frame.size;
    Drawing.draw_rounded_rect(ctx, background,
        -bgSize / 2, -bgSize / 2, bgSize, bgSize, 0, 18);
    if (borderWidth)
        Drawing.draw_rounded_rect(ctx, border,
            -bgSize / 2, -bgSize / 2, bgSize, bgSize, borderWidth, 18);
    ctx.restore();
}

function _drawDial(ctx, size, settings) {
    if (!settings.dial)
        return;
    const {background, border, borderWidth} = settings.dial;
    ctx.save();
    const bgSize = size * settings.dial.size;
    Drawing.draw_circle(ctx, background, 0, 0, bgSize);
    if (borderWidth)
        Drawing.draw_circle(ctx, border, 0, 0, bgSize, borderWidth);
    ctx.restore();
}

function _drawMarks(ctx, size, settings) {
    if (!settings.marks)
        return;
    const {color, width} = settings.marks;
    ctx.save();
    for (let i = 0; i < 12; i++) {
        const a = (360 / 12) * i;
        const mark = size * 0.75;
        Drawing.draw_rotated_line(ctx, color, width,
            a * (Math.PI / 180),
            -Math.floor((size * 0.9) / 2.7),
            -Math.floor(mark / 2.7));
    }
    ctx.restore();
}

function _drawHands(ctx, size, date, settings) {
    const {hour, minute} = settings.hands;
    const h0 = date.getHours();
    const m0 = date.getMinutes();
    Drawing.draw_rotated_line(ctx, minute, size / 20,
        (h0 * 30 + (m0 * 30) / 60) * (Math.PI / 180),
        -Math.floor(size / 3.7));
    Drawing.draw_circle(ctx, minute, 0, 0, size / 12);
    Drawing.draw_rotated_line(ctx, hour, size / 33,
        m0 * 6 * (Math.PI / 180),
        -Math.floor(size / 2.7));
}

export const ClockWidget = GObject.registerClass(
    {GTypeName: 'LooknFeelClockWidget'},
    class ClockWidget extends St.Widget {
        _init(size = 120) {
            super._init();
            this._canvas = new ClockCanvas();
            this._canvas.width = size;
            this._canvas.height = size;
            this.add_child(this._canvas);
            this._lastMinute = -1;
        }

        // True when the displayed minute rolled over and a repaint is due.
        // Called every frame; cheap (one Date + int compare), no timers.
        sync() {
            const minute = new Date().getMinutes();
            if (minute === this._lastMinute)
                return false;
            this._lastMinute = minute;
            this._canvas.queue_repaint();
            return true;
        }

        hideWidget() {
            this.visible = false;
        }
    }
);

const ClockCanvas = GObject.registerClass(
    {GTypeName: 'LooknFeelClockCanvas'},
    class ClockCanvas extends St.DrawingArea {
        _init() {
            super._init();
        }

        vfunc_repaint() {
            const ctx = this.get_context();
            const [width] = this.get_surface_size();
            ctx.setOperator(Cairo.Operator.CLEAR);
            ctx.paint();
            const size = width;
            ctx.translate(size / 2, size / 2);
            ctx.setLineWidth(1);
            ctx.setLineCap(Cairo.LineCap.ROUND);
            ctx.setOperator(Cairo.Operator.SOURCE);
            const style = _defaultStyle(PALETTE);
            ctx.save();
            ctx.translate(0, 0);
            _drawFrame(ctx, size, style);
            _drawDial(ctx, size, style);
            _drawMarks(ctx, size, style);
            _drawHands(ctx, size, new Date(), style);
            ctx.restore();
            ctx.$dispose();
        }
    }
);
