// Tiny geometry helpers shared by the dock module.
// Ported from dash2dock-lite by icedman (GPL-2.0-or-later).

export function getDistanceSqr(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
}

export function isInRect(rect, p, pad = 0) {
    const [x, y, w, h] = rect;
    const [px, py] = p;
    return px + pad >= x && px - pad < x + w &&
           py + pad >= y && py - pad < y + h;
}

export function isOverlapRect(r1, r2) {
    const [x1, y1, w1, h1] = r1;
    const [x2, y2, w2, h2] = r2;
    return x1 + w1 >= x2 && x1 <= x2 + w2 &&
           y1 + h1 >= y2 && y1 <= y2 + h2;
}
