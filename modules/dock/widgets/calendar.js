// Live calendar overlay for the Calendar app icon in the dock. Ported from
// dash2dock-lite's apps/calendar.js by icedman (GPL-2.0-or-later). Fixed
// look (upstream has no styles for it). Redrawn only when the day changes.

import Cairo from 'gi://cairo';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Drawing} from '../drawing.js';

export const CalendarWidget = GObject.registerClass(
    {GTypeName: 'LooknFeelCalendarWidget'},
    class CalendarWidget extends St.Widget {
        _init(size = 120) {
            super._init();
            this._canvas = new CalendarCanvas();
            this._canvas.width = size;
            this._canvas.height = size;
            this.add_child(this._canvas);
            this._lastDay = -1;
        }

        // True when the day rolled over and a repaint is due. Called every
        // frame; cheap, no timers.
        sync() {
            const day = new Date().getDate();
            if (day === this._lastDay)
                return false;
            this._lastDay = day;
            this._canvas.queue_repaint();
            return true;
        }

        hideWidget() {
            this.visible = false;
        }
    }
);

const CalendarCanvas = GObject.registerClass(
    {GTypeName: 'LooknFeelCalendarCanvas'},
    class CalendarCanvas extends St.DrawingArea {
        _init() {
            super._init();
        }

        vfunc_repaint() {
            const ctx = this.get_context();
            const [width] = this.get_surface_size();
            const size = width;
            const bg_color = '#dddddd';
            const day_color = '#000000';
            const date_color = '#ff0000';
            ctx.setOperator(Cairo.Operator.CLEAR);
            ctx.paint();
            ctx.translate(size / 2, size / 2);
            ctx.setLineWidth(1);
            ctx.setLineCap(Cairo.LineCap.ROUND);
            ctx.setOperator(Cairo.Operator.SOURCE);
            const bgSize = size * 0.85;
            const offset = size - bgSize;
            const d0 = new Date();
            Drawing.draw_rounded_rect(ctx, bg_color,
                -size / 2 + offset / 2, -size / 2 + offset / 2,
                bgSize, bgSize, 0, 16);
            Drawing.set_color(ctx, date_color, 1.0);
            ctx.moveTo(0, 14);
            Drawing.draw_text(ctx, `${d0.getDate()}`, 'DejaVuSans 40');
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            Drawing.set_color(ctx, day_color, 1.0);
            ctx.moveTo(0, -24);
            Drawing.draw_text(ctx, `${dayNames[d0.getDay()]}`, 'DejaVuSans 20');
            ctx.$dispose();
        }
    }
);
