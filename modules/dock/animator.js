// Frame animator: pointer tracking, magnification / spread / rise,
// per-icon easing, icon renderers, running indicators and badges,
// launch bounce, and dock slide in/out. The real dash icons stay hidden;
// magnified copies are drawn as St.Icon renderers in the render area.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

import GLib from 'gi://GLib';
import St from 'gi://St';

import { getDistanceSqr } from './geom.js';
import { RunningIndicator, NotificationBadge, indicatorStyleName } from './dockItems.js';

const FRAME_MS = 15;
const END_DEBOUNCE_MS = 750;
const ANIM_POSITION_PER_SEC = 550 / 1000;
const ANIM_SIZE_PER_SEC = 250 / 1000;
const ANIM_ICON_RAISE = 0.5;
const ANIM_ICON_SCALE = 1.5;
const ANIM_ICON_HIT_AREA = 2.5;
const RENDERER_BASE_SIZE = 32;

const quadraticOut = p => -(p * (p - 2));
const cubicOut = p => {
    const f = p - 1;
    return f * f * f + 1;
};
// Penner bounce-out, (t, b, c, d) form.
const bounceOut = (t, b, c, d) => {
    if ((t /= d) < 1 / 2.75)
        return c * (7.5625 * t * t) + b;
    if (t < 2 / 2.75) {
        const p = t - 1.5 / 2.75;
        return c * (7.5625 * p * t + 0.75) + b;
    }
    if (t < 2.5 / 2.75) {
        const p = t - 2.25 / 2.75;
        return c * (7.5625 * p * t + 0.9375) + b;
    }
    const p = t - 2.625 / 2.75;
    return c * (7.5625 * p * t + 0.984375) + b;
};

export class Animator {
    constructor(dock, signals, settings) {
        this._dock = dock;
        this._signals = signals;
        this._settings = settings;
        this._renderers = [];
        this._indicators = [];
        this._badges = [];
        this._running = false;
        this._endId = null;
    }

    enable() {
        this.begin();
    }

    disable() {
        this._running = false;
        this._cancelEnd();
        for (const actor of [...this._renderers, ...this._indicators, ...this._badges])
            actor.destroy();
        this._renderers = [];
        this._indicators = [];
        this._badges = [];
    }

    begin() {
        this._cancelEnd();
        if (this._running)
            return;
        this._running = true;
        this._signals.addTimer(FRAME_MS, () => {
            if (!this._running)
                return false;
            this._dock.animate(FRAME_MS);
            return true;
        });
    }

    // Stop the frame loop after the dock has been idle for a while.
    debounceEnd() {
        this._cancelEnd();
        this._endId = this._signals.addTimer(END_DEBOUNCE_MS, () => {
            this._endId = null;
            this._running = false;
            this._dock._endAnimation();
            return false;
        });
    }

    _cancelEnd() {
        if (this._endId !== null) {
            try {
                GLib.source_remove(this._endId);
            } catch {
                /* already fired */
            }
            this._endId = null;
        }
    }

    _precreate(dock) {
        const count = dock._icons.length;
        if (!count)
            return false;
        while (this._renderers.length < count) {
            const renderer = new St.Icon({
                icon_name: 'file',
                reactive: false,
                icon_size: RENDERER_BASE_SIZE,
            });
            renderer.visible = false;
            dock.renderArea.add_child(renderer);
            this._renderers.push(renderer);

            const indicator = new RunningIndicator();
            indicator.visible = false;
            dock.renderArea.add_child(indicator);
            this._indicators.push(indicator);

            const badge = new NotificationBadge();
            badge.visible = false;
            dock.renderArea.add_child(badge);
            this._badges.push(badge);
        }
        for (let i = count; i < this._renderers.length; i++) {
            this._renderers[i].visible = false;
            this._indicators[i].visible = false;
            this._badges[i].visible = false;
        }
        return true;
    }

    animate(dt) {
        const dock = this._dock;
        const settings = this._settings;
        if (dock._hoveredIcon)
            dock._lastHoveredIcon = dock._hoveredIcon;

        if (!dock.layout())
            return;
        if (!this._precreate(dock))
            return;

        // Fade the dock in on first show.
        let didFadeIn = false;
        if (dock.opacity < 255) {
            didFadeIn = true;
            const step = Math.min((255 / 500) * dt, 255 - dock.opacity);
            dock.opacity += Math.floor(step);
            if (dock.renderArea.opacity < 255 && dock.opacity > 50)
                dock.renderArea.opacity = dock.opacity;
        }

        const monitor = dock._monitor;
        const [px, py] = global.get_pointer();
        const vertical = dock.isVertical();
        let isWithin = dock._isWithinDash([px, py]);
        if (monitor.inFullscreen)
            isWithin = false;
        dock.animated = isWithin;

        const icons = dock._icons;
        const iconSize = dock._iconSizeScaledDown;
        const scaleFactor = dock._scaleFactor;
        const animateOn = settings.getBoolean('dock-animate');

        // Nearest icon to the pointer.
        let nearestIcon = null;
        let nearestDistance = -1;
        const centerOffset = (iconSize * scaleFactor) / 2;
        let hitArea = iconSize * ANIM_ICON_HIT_AREA * scaleFactor;
        hitArea *= hitArea;
        let idx = 0;
        for (const entry of icons) {
            const pos = entry.container.get_transformed_position();
            entry._pos = [pos[0], pos[1]];
            if (isWithin && animateOn) {
                const dst = getDistanceSqr([px, py],
                    [pos[0] + centerOffset, pos[1] + centerOffset]);
                if ((nearestDistance === -1 || dst < nearestDistance) && dst < hitArea) {
                    nearestDistance = dst;
                    nearestIcon = entry;
                }
            }
            entry._targetScale = 1;
            entry._idx = idx++;
        }
        dock._nearestIcon = nearestIcon;

        // Magnification parameters.
        const edgeDistance = dock._edgeDistance;
        const rise = settings.getDouble('dock-rise') * ANIM_ICON_RAISE;
        let magnify = settings.getDouble('dock-magnify') * ANIM_ICON_SCALE;
        let spread = settings.getDouble('dock-spread');
        if (spread < 0.2)
            magnify *= 0.8;
        if (magnify > 0.15 && spread < 0.55)
            spread = 0.55 + spread * 0.2;
        const threshold = (iconSize + 10) * 2.5 * scaleFactor;
        const Ease = settings.getInt('dock-rise-curve') === 1 ? cubicOut : quadraticOut;
        const scaleAtMax = magnify !== 0 ? 1 + magnify : 1;

        // Per-icon scale and rise from pointer distance.
        let didScale = false;
        for (const entry of icons) {
            const cx = entry._pos[0] + entry.container.width / 2;
            const cy = entry._pos[1] + entry.container.height / 2;
            const d = vertical ? cy - py : cx - px;
            entry._translate = 0;
            entry._translateRise = 0;
            entry._hoverProgress = 0;
            let scale = 1;
            if (d * d < threshold * threshold && nearestIcon) {
                const hoverProgress = 1 - Math.abs(d) / threshold;
                entry._hoverProgress = hoverProgress;
                if (magnify !== 0) {
                    scale = scaleAtMax * Ease(hoverProgress);
                    if (scale < 1)
                        scale = 1;
                }
                entry._translateRise = iconSize * (scale - 1) * scaleFactor * rise;
                didScale = true;
            }
            entry._scale = scale;
            entry._targetScale = scale;
        }

        // Spread: magnified icons push their neighbors aside.
        let largestScale = 1;
        let hoveredIcon = dock._lastHoveredIcon;
        for (let i = 0; i < icons.length; i++) {
            const entry = icons[i];
            if (entry._targetScale > largestScale) {
                largestScale = entry._targetScale;
                hoveredIcon = entry;
            }
            if (entry._scale > 1.1) {
                const offset = Math.floor(
                    1.25 * (entry._scale - 1) * iconSize * scaleFactor * spread * 0.5);
                for (let j = i - 1; j >= 0; j--)
                    icons[j]._translate -= offset;
                for (let j = i + 1; j < icons.length; j++)
                    icons[j]._translate += offset;
            }
        }
        dock._hoveredIcon = hoveredIcon;

        // Re-center the spread on the nearest icon.
        if (nearestIcon) {
            nearestIcon._targetScale += 0.1;
            const adjust = nearestIcon._translate / 2;
            for (const entry of icons) {
                if (entry._scale > 1) {
                    const nt = entry._translate + adjust * (2 - entry._scale);
                    entry._translate = (entry._translate * 24 + nt) / 25;
                }
            }
        }

        // Ease icon translations toward their targets.
        const slowDown = didScale ? 1 : 0.5;
        const first = icons[0];
        const last = icons[icons.length - 1];
        const lockPosition = didScale && first._hoverProgress === 0 && last._hoverProgress === 0;
        const isTopOrLeft = dock._position === 'top' || dock._position === 'left';
        const riseDir = isTopOrLeft ? 1 : -1;
        for (const entry of icons) {
            if (entry._targetScale > 1.9)
                entry._targetScale = 2;
            entry._scale = entry._targetScale;
            let tx, ty;
            if (vertical) {
                tx = entry._translateRise * riseDir;
                ty = entry._translate;
            } else {
                tx = entry._translate;
                ty = entry._translateRise * riseDir;
            }
            const dx = tx - entry.icon.translationX;
            const dy = ty - entry.icon.translationY;
            const mag = Math.hypot(dx, dy);
            if (mag > 0) {
                const step = Math.min(ANIM_POSITION_PER_SEC * slowDown * dt, mag);
                tx = entry.icon.translationX + (dx / mag) * step;
                ty = entry.icon.translationY + (dy / mag) * step;
            }
            // Jitter lock: average recent positions when settled.
            if (lockPosition && entry._hoverProgress === 0) {
                entry._posCache = entry._posCache || [];
                if (entry._posCache.length > 48) {
                    [tx, ty] = entry._posCache[entry._posCache.length - 1];
                } else {
                    entry._posCache.push([tx, ty]);
                    if (entry._posCache.length > 4) {
                        let sx = 0, sy = 0;
                        for (let k = 0; k < 4; k++) {
                            sx += entry._posCache[entry._posCache.length - 4 + k][0];
                            sy += entry._posCache[entry._posCache.length - 4 + k][1];
                        }
                        tx = sx / 4;
                        ty = sy / 4;
                    }
                }
            } else {
                entry._posCache = null;
            }
            entry.icon.translationX = (entry.icon.translationX + tx * 3) / 4;
            entry.icon.translationY = (entry.icon.translationY + ty * 3) / 4;
        }

        // Draw the renderers.
        const renderOffset = dock.renderArea.get_transformed_position();
        const unscaled = iconSize * scaleFactor;
        // TEMP-DEBUG (debug-dock branch only)
        this._dbgFrames = (this._dbgFrames || 0) + 1;
        if (this._dbgFrames === 30 || this._dbgFrames % 600 === 0) {
            const e0 = icons[0];
            const s0 = e0?.icon;
            log(`DBG frame=${this._dbgFrames} icons=${icons.length} ` +
                `renderers=${this._renderers.length} renderAreaOpacity=${dock.renderArea.opacity} ` +
                `renderAreaVisible=${dock.renderArea.visible} ` +
                `src0=${s0 ? `gicon=${!!s0.gicon} icon_name=${s0.icon_name}` : 'none'} ` +
                `r0=${this._renderers[0] ? `vis=${this._renderers[0].visible} op=${this._renderers[0].opacity} ` +
                    `x=${Math.round(this._renderers[0].x)} y=${Math.round(this._renderers[0].y)} ` +
                    `w=${Math.round(this._renderers[0].width)} scale=${this._renderers[0].scaleX.toFixed(2)} ` +
                    `gicon=${!!this._renderers[0].gicon} icon_name=${this._renderers[0].icon_name}` : 'none'}`);
        }
        for (const entry of icons) {
            const renderer = this._renderers[entry._idx];
            entry._renderer = renderer;
            const src = entry.icon;
            if (src.gicon)
                renderer.gicon = src.gicon;
            else if (src.icon_name)
                renderer.icon_name = src.icon_name;
            renderer.set_style_class_name('');

            const targetSize = unscaled * entry._targetScale;
            const currentSize = renderer.icon_size * renderer.scaleX;
            const dst = targetSize - currentSize;
            let applied = ANIM_SIZE_PER_SEC * slowDown * Math.sign(dst) * dt;
            if (Math.abs(applied) > Math.abs(dst))
                applied = dst * 0.5;
            const newSize = currentSize + applied;
            entry._scale = newSize / unscaled;

            if (renderer.icon_size !== RENDERER_BASE_SIZE) {
                renderer.set_size(RENDERER_BASE_SIZE, RENDERER_BASE_SIZE);
                renderer.set_icon_size(RENDERER_BASE_SIZE);
            }
            renderer.set_scale(newSize / RENDERER_BASE_SIZE, newSize / RENDERER_BASE_SIZE);

            const p = entry.container.get_transformed_position();
            if (!isNaN(p[0]) && !isNaN(p[1])) {
                let adjustX = entry.container.width / 2 - newSize / 2;
                let adjustY = entry.container.height / 2 - newSize / 2;
                if (newSize > entry.container.height) {
                    const r = (newSize - entry.container.height) * 0.5;
                    if (vertical)
                        adjustX += r * (dock._position === 'left' ? 1 : -1);
                    else
                        adjustY += r * (dock._position === 'bottom' ? -1 : 1);
                }
                const iconParent = src.get_parent();
                if (iconParent) {
                    if (vertical)
                        iconParent.translationX = adjustX / 2;
                    else
                        iconParent.translationY = adjustY / 2;
                    renderer.set_position(
                        p[0] + adjustX + src.translationX - renderOffset[0],
                        p[1] + adjustY + src.translationY - renderOffset[1]);
                    renderer.visible = true;
                }
            }
            renderer.opacity = 255;

            // Hover label.
            const label = entry.label;
            if (label) {
                if (entry === hoveredIcon && label.text) {
                    const tPos = renderer.get_transformed_position();
                    const tSize = renderer.get_transformed_size();
                    const lsz = label.get_transformed_size();
                    if (!isNaN(tPos[0]) && !isNaN(lsz[0]) && lsz[0] > 0) {
                        label.x = tPos[0] + tSize[0] / 2 - lsz[0] / 2;
                        label.y = tPos[1] + tSize[1] / 2 - lsz[1] / 2;
                        if (vertical)
                            label.x += (tSize[1] / 1.5 + label.width / 2) * (dock._position === 'left' ? 1 : -1);
                        else
                            label.y += (tSize[1] / 1.25) * (dock._position === 'bottom' ? -1 : 1);
                        label.opacity = Math.min(255, label.opacity + 40);
                    }
                } else if (label.opacity !== 0) {
                    label.opacity = 0;
                }
            }

            // Notification badge.
            const badge = this._badges[entry._idx];
            badge.visible = false;
            const notices = entry.appId ? dock._services.getNoticeCount(entry.appId) : 0;
            if (notices > 0) {
                const rSize = renderer.width * renderer.scaleX;
                const bSize = rSize * 0.5;
                badge.update({ count: notices });
                badge.place(renderer.x + rSize - bSize * 0.7, renderer.y - bSize * 0.2, bSize);
                badge.visible = true;
            }

            // Running indicator.
            const dots = this._indicators[entry._idx];
            dots.visible = false;
            const wins = entry.appwell?.app?.get_windows?.() ?? [];
            if (wins.length > 0) {
                const rSize = renderer.width * renderer.scaleX;
                dots.update({
                    count: wins.length,
                    style: indicatorStyleName(settings.getInt('dock-running-indicator-style')),
                    rotate: vertical
                        ? (dock._position === 'right' ? -90 : 90)
                        : (dock._position === 'top' ? 180 : 0),
                });
                dots.place(renderer.x, renderer.y, rSize, entry._scale);
                dots.visible = true;
            }
        }

        // Reveal when the pointer reaches a hidden dock.
        const autohideActive = settings.getBoolean('dock-autohide') ||
            settings.getBoolean('dock-dodge-windows');
        if (dock._hidden && autohideActive && isWithin)
            dock.slideIn();

        // Slide the dash in/out + edge distance.
        const edgeMult = (dock._position === 'bottom' || dock._position === 'right') ? 1 : -1;
        let targetX = 0, targetY = 0;
        if (dock._hidden) {
            if (vertical) {
                const w = dock._background.width;
                targetX = dock._position === 'left'
                    ? -(w + edgeDistance * -edgeMult * 2) * scaleFactor
                    : (w - edgeDistance * -edgeMult * 2) * scaleFactor;
            } else {
                const h = dock._background.height;
                targetY = dock._position === 'bottom'
                    ? (h - edgeDistance * -edgeMult * 2) * scaleFactor
                    : -(h + edgeDistance * -edgeMult * 2) * scaleFactor;
            }
        }
        if (vertical)
            targetX += edgeDistance * -edgeMult;
        else
            targetY += edgeDistance * -edgeMult;
        {
            const dx = targetX - dock._dash.translationX;
            const dy = targetY - dock._dash.translationY;
            const mag = Math.hypot(dx, dy);
            if (mag > 0) {
                const step = Math.min((350 * scaleFactor / 1000) * dt, mag);
                dock._dash.translationX += (dx / mag) * step;
                dock._dash.translationY += (dy / mag) * step;
            }
        }

        // Background pill follows the icons.
        if (first && last && first !== last) {
            const dp = dock._dash.get_transformed_position();
            const op = dock.get_transformed_position();
            dock._background.update({
                firstTx: first.icon.translationX,
                firstTy: first.icon.translationY,
                lastTx: last.icon.translationX,
                lastTy: last.icon.translationY,
                dashX: dp[0] - op[0],
                dashY: dp[1] - op[1],
                dashW: dock._dash.width,
                dashH: dock._dash.height,
                vertical,
                panelMode: settings.getBoolean('dock-panel-mode'),
                containerW: dock.width,
                containerH: dock.height,
                iconSize,
                scaleFactor,
            });
        } else {
            dock._background.opacity = 0;
        }

        // Struts: reserve space when not autohiding; used for hit-testing
        // and intellihide overlap checks when autohiding.
        const bg = dock._background;
        const struts = dock._struts;
        if (autohideActive) {
            const bp = bg.get_transformed_position();
            struts.x = bp[0];
            struts.y = bp[1];
            struts.width = bg.width;
            struts.height = bg.height;
        } else if (vertical) {
            struts.width = bg.width + iconSize * 0.2 * scaleFactor + edgeDistance;
            struts.height = dock.height;
            struts.x = dock.x + (dock._position === 'right' ? dock.width - struts.width : 0);
            struts.y = dock.y;
        } else {
            struts.width = dock.width;
            struts.height = bg.height + iconSize * 0.2 * scaleFactor + edgeDistance;
            struts.x = dock.x;
            struts.y = dock.y + (dock._position === 'bottom' ? dock.height - struts.height : 0);
        }
        struts.visible = !dock._hidden;

        dock._dash.opacity = 255;

        if (didFadeIn || didScale) {
            dock._debounceEndAnimation();
            dock._autohide.checkSoon();
        }
    }

    // Simplified launch bounce: quick rise, then a bouncing settle.
    bounceIcon(entry) {
        const dock = this._dock;
        const renderer = entry?._renderer;
        if (!renderer)
            return;
        dock._beginAnimation();
        const vertical = dock.isVertical();
        const travel = Math.max(24, (dock._iconSize || 64) * 0.6);
        const dir = vertical
            ? (dock._position === 'left' ? 1 : -1)
            : (dock._position === 'bottom' ? -1 : 1);
        const prop = vertical ? 'translationX' : 'translationY';
        let t = 0;
        const duration = 650;
        this._signals.addTimer(FRAME_MS, () => {
            t += FRAME_MS;
            const p = Math.min(t / duration, 1);
            let off;
            if (p < 0.3)
                off = -travel * (p / 0.3);
            else
                off = -travel * (1 - bounceOut((p - 0.3) / 0.7, 0, 1, 1));
            renderer[prop] = off * dir;
            if (p >= 1) {
                renderer[prop] = 0;
                return false;
            }
            return true;
        });
    }
}
