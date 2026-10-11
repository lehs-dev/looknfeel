// Canvas helpers and the Dot indicator/badge renderer (running-app dots,
// notification badges). Merged from drawing.js + apps/dot.js.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

// Canvas helpers for the live clock/calendar app widgets. Drawing routines
// adapted from dash2dock-lite by icedman (GPL-2.0-or-later).
export const Drawing = {
    set_color(ctx, clr, alpha) {
        if (typeof clr === 'string') {
            const [, cc] = (Cogl?.Color.from_string || Clutter.Color.from_string)(clr);
            ctx.setSourceRGBA(cc.red, cc.green, cc.blue, alpha);
        } else if (clr.red) {
            ctx.setSourceRGBA(clr.red, clr.green, clr.blue, alpha);
        } else {
            ctx.setSourceRGBA(clr[0], clr[1], clr[2], alpha);
        }
    },

    draw_rotated_line(ctx, color, width, angle, len, offset) {
        offset = offset || 0;
        ctx.save();
        ctx.rotate(angle);
        Drawing.set_color(ctx, color, 1);
        ctx.setLineWidth(width);
        ctx.moveTo(0, offset);
        ctx.lineTo(0, len);
        ctx.stroke();
        ctx.restore();
    },

    draw_circle(ctx, color, x, y, diameter, line_width) {
        ctx.save();
        Drawing.set_color(ctx, color, 1);
        ctx.arc(x, y, diameter / 2 - diameter / 20, 0, 2 * Math.PI);
        ctx.setLineWidth(line_width || 0);
        if (line_width > 0)
            ctx.stroke();
        else
            ctx.fill();
        ctx.restore();
    },

    draw_rounded_rect(ctx, color, x, y, h_size, v_size, line_width, border_radius) {
        ctx.save();
        Drawing.set_color(ctx, color, 1);
        ctx.translate(x, y);
        ctx.setLineWidth(line_width || 0);
        ctx.moveTo(border_radius, 0);
        ctx.lineTo(h_size - border_radius, 0);
        ctx.curveTo(h_size - border_radius, 0, h_size, 0, h_size, border_radius);
        ctx.lineTo(h_size, v_size - border_radius);
        ctx.curveTo(h_size, v_size - border_radius, h_size, v_size,
            h_size - border_radius, v_size);
        ctx.lineTo(border_radius, v_size);
        ctx.curveTo(border_radius, v_size, 0, v_size, 0, v_size - border_radius);
        ctx.lineTo(0, border_radius);
        ctx.curveTo(0, border_radius, 0, 0, border_radius, 0);
        if (line_width == 0)
            ctx.fill();
        else
            ctx.stroke();
        ctx.restore();
    },

    draw_text(ctx, showtext, font = 'DejaVuSans 42') {
        ctx.save();
        const pl = PangoCairo.create_layout(ctx);
        pl.set_text(showtext, -1);
        pl.set_font_description(Pango.FontDescription.from_string(font));
        PangoCairo.update_layout(ctx, pl);
        const [w, h] = pl.get_pixel_size();
        ctx.relMoveTo(-w / 2, -h / 2);
        PangoCairo.show_layout(ctx, pl);
        ctx.relMoveTo(w / 2, 0);
        ctx.restore();
        return [w, h];
    },
};

export const Dot = GObject.registerClass(
    { GTypeName: 'LooknFeelDot' },
    class Dot extends St.Widget {
        _init(size = 96) {
            super._init();
            this._canvas = new DotCanvas();
            this._canvas.width = size;
            this._canvas.height = size;
            this.add_child(this._canvas);
            this.set_state = this._canvas.set_state.bind(this._canvas);
        }
    }
);

const DotCanvas = GObject.registerClass(
    { GTypeName: 'LooknFeelDotCanvas' },
    class DotCanvas extends St.DrawingArea {
        _init() {
            super._init();
            this.state = {};
            this._padding = 8;
            this._barHeight = 6;
        }

        set_state(s) {
            const equal = (a, b) => a === b ||
                (Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
                    a.every((value, i) => value === b[i]));
            if (!this.state ||
                this.state.count !== s.count ||
                !equal(this.state.color, s.color) ||
                this.state.style !== s.style ||
                this.state.rotate !== s.rotate ||
                this.state.size !== s.size) {
                this.state = s;
                this.queue_repaint();
            }
        }

        _dotSize(h) {
            const sz = [0.8, 0.5, 1.0];
            return h * (sz[this.state.size] || 1);
        }

        vfunc_repaint() {
            const ctx = this.get_context();
            const [width] = this.get_surface_size();

            if (!this.state?.color || !this.state?.count) {
                ctx.$dispose();
                return;
            }

            ctx.setOperator(Cairo.Operator.CLEAR);
            ctx.paint();
            ctx.setLineWidth(1);
            ctx.setLineCap(Cairo.LineCap.ROUND);
            ctx.setOperator(Cairo.Operator.SOURCE);
            ctx.save();
            ctx.translate(width / 2, width / 2);
            if (this.state.rotate)
                ctx.rotate((this.state.rotate * Math.PI) / 180);
            ctx.translate(-width / 2, -width / 2);

            const draw = this[`_draw_${this.state.style}`];
            if (typeof draw === 'function')
                draw.call(this, ctx, this.state);

            ctx.restore();
            ctx.$dispose();
        }

        _fillShapes(ctx, state) {
            ctx.strokePreserve();
            Drawing.set_color(ctx, state.color, state.color[3]);
            ctx.fill();
        }

        _draw_segmented(ctx, state) {
            const [size] = this.get_surface_size();
            const count = Math.min(4, state.count);
            const height = this._dotSize(this._barHeight);
            const width = size - this._padding * 2;
            ctx.translate(this._padding, size - height * 2.5);
            const spacing = Math.ceil(width / 18);
            const dashLength = Math.ceil((width - (count - 1) * spacing) / count);
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                ctx.rectangle(i * dashLength + i * spacing, 0, dashLength, height);
            }
            this._fillShapes(ctx, state);
        }

        _draw_solid(ctx, state) {
            this._draw_segmented(ctx, { ...state, count: 1 });
        }

        _draw_dashes(ctx, state) {
            const [size] = this.get_surface_size();
            const count = Math.min(4, state.count);
            const height = this._dotSize(this._barHeight + 2);
            const width = size - this._padding * 2;
            const spacing = Math.ceil(width / 16);
            const dashLength = Math.floor(width / 4) - spacing;
            ctx.translate(
                Math.floor((size - count * dashLength - (count - 1) * spacing) / 2),
                size - height * 1.5
            );
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                ctx.rectangle(i * dashLength + i * spacing, 0, dashLength, height);
            }
            this._fillShapes(ctx, state);
        }

        _draw_dash(ctx, state) {
            this._draw_dashes(ctx, { ...state, count: 1 });
        }

        _draw_squares(ctx, state) {
            const [size] = this.get_surface_size();
            const count = Math.min(4, state.count);
            const height = this._dotSize(this._barHeight + 5);
            const width = size - this._padding * 2;
            const spacing = Math.ceil(width / 18);
            const dashLength = height;
            ctx.translate(
                Math.floor((size - count * dashLength - (count - 1) * spacing) / 2),
                size - height * 1.5
            );
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                ctx.rectangle(i * dashLength + i * spacing, 0, dashLength, height);
            }
            this._fillShapes(ctx, state);
        }

        _draw_square(ctx, state) {
            this._draw_squares(ctx, { ...state, count: 1 });
        }

        _draw_triangles(ctx, state) {
            const [size] = this.get_surface_size();
            const count = Math.min(4, state.count);
            const height = this._dotSize(this._barHeight + 6);
            const width = size - this._padding * 2;
            const spacing = Math.ceil(width / 16);
            const dashLength = height + 8;
            ctx.translate(
                Math.floor((size - count * dashLength - (count - 1) * spacing) / 2),
                size - height * 1.5
            );
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                const x = i * dashLength + i * spacing;
                ctx.moveTo(x + dashLength / 2, 0);
                ctx.lineTo(x, height);
                ctx.lineTo(x + dashLength, height);
            }
            this._fillShapes(ctx, state);
        }

        _draw_triangle(ctx, state) {
            this._draw_triangles(ctx, { ...state, count: 1 });
        }

        _draw_diamonds(ctx, state) {
            const [size] = this.get_surface_size();
            const count = Math.min(4, state.count);
            const height = this._dotSize(this._barHeight + 10);
            const width = size - this._padding * 2;
            const spacing = Math.ceil(width / 16);
            const dashLength = height;
            ctx.translate(
                Math.floor((size - count * dashLength - (count - 1) * spacing) / 2),
                size - height * 1.5
            );
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                const x = i * dashLength + i * spacing;
                ctx.moveTo(x + dashLength / 2, 0);
                ctx.lineTo(x, height / 2);
                ctx.lineTo(x + dashLength / 2, height);
                ctx.lineTo(x + dashLength, height / 2);
            }
            this._fillShapes(ctx, state);
        }

        _draw_diamond(ctx, state) {
            this._draw_diamonds(ctx, { ...state, count: 1 });
        }

        _draw_dots(ctx, state) {
            const [size] = this.get_surface_size();
            const count = Math.min(4, state.count);
            const height = this._dotSize(this._barHeight);
            const width = size - this._padding * 2;
            const spacing = Math.ceil(width / 18);
            const radius = height;
            ctx.translate(
                Math.floor((size - count * radius - (count - 1) * spacing) / 2 - radius / 2),
                size - height
            );
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                ctx.arc((2 * i + 1) * radius + i * radius, -radius, radius, 0, 2 * Math.PI);
            }
            this._fillShapes(ctx, state);
        }

        _draw_dot(ctx, state) {
            this._draw_dots(ctx, { ...state, count: 1 });
        }

        _draw_binary(ctx, state) {
            const [size] = this.get_surface_size();
            const count = 4;
            const n = Math.min(15, state.count);
            const binaryValue = String('0000' + (n >>> 0).toString(2)).slice(-4);
            const height = this._dotSize(this._barHeight + 2);
            const width = size - this._padding * 2;
            const spacing = Math.ceil(width / 14);
            const dashLength = height * 1.4;
            const radius = height * 0.9;
            ctx.translate(
                Math.floor((size - count * dashLength - (count - 1) * spacing) / 2),
                size - height * 1.5 - radius / 2
            );
            for (let i = 0; i < count; i++) {
                ctx.newSubPath();
                if (binaryValue[i] === '1') {
                    ctx.arc(i * dashLength + i * spacing + dashLength / 2, radius / 2, radius, 0, 2 * Math.PI);
                } else {
                    ctx.rectangle(i * dashLength + i * spacing, 0, dashLength, height - 2);
                }
            }
            this._fillShapes(ctx, state);
        }
    }
);
