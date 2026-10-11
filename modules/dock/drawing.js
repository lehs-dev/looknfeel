// Canvas helpers and the Dot indicator/badge renderer (running-app dots,
// notification badges). Merged from drawing.js + apps/dot.js.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import St from 'gi://St';

function setColor(ctx, color, alpha) {
    let r = 1, g = 1, b = 1;
    const norm = v => (v > 1 ? v / 255 : v);
    if (typeof color === 'string') {
        const [, cc] = (Cogl?.Color.from_string || Clutter.Color.from_string)(color);
        r = norm(cc.red); g = norm(cc.green); b = norm(cc.blue);
    } else if (color.red !== undefined) {
        r = norm(color.red); g = norm(color.green); b = norm(color.blue);
    } else if (Array.isArray(color)) {
        [r, g, b] = color;
    }
    ctx.setSourceRGBA(r, g, b, alpha ?? color?.[3] ?? 1);
}

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
            setColor(ctx, state.color, state.color[3]);
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
