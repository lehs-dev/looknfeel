// Fractional tile layouts (tiles are 0..1 fractions of the work area) and
// rect helpers. Layout math adapted from Tiling Shell by Domenico Ferraro
// (GPL-3.0-or-later).

// A tile is a plain {x, y, width, height} object in work-area fractions.
export const LAYOUTS = [
    {
        id: 'halves',
        tiles: [
            {x: 0, y: 0, width: 0.5, height: 1},
            {x: 0.5, y: 0, width: 0.5, height: 1},
        ],
    },
    {
        id: 'quarters',
        tiles: [
            {x: 0, y: 0, width: 0.5, height: 0.5},
            {x: 0.5, y: 0, width: 0.5, height: 0.5},
            {x: 0, y: 0.5, width: 0.5, height: 0.5},
            {x: 0.5, y: 0.5, width: 0.5, height: 0.5},
        ],
    },
];

export function allTiles() {
    return LAYOUTS.flatMap(layout => layout.tiles);
}

// Tile -> pixel rect inside workArea.
export function tileToRect(tile, workArea) {
    return {
        x: Math.round(workArea.x + tile.x * workArea.width),
        y: Math.round(workArea.y + tile.y * workArea.height),
        width: Math.round(tile.width * workArea.width),
        height: Math.round(tile.height * workArea.height),
    };
}

// Per-side gaps for a tile rect: the outer gap on sides touching the work
// area border, half the inner gap on shared sides (cf. buildTileGaps).
export function tileGaps(rect, workArea, innerGaps, outerGaps) {
    const onLeft = Math.abs(rect.x - workArea.x) <= 1;
    const onTop = Math.abs(rect.y - workArea.y) <= 1;
    const onRight = Math.abs(rect.x + rect.width -
        (workArea.x + workArea.width)) <= 1;
    const onBottom = Math.abs(rect.y + rect.height -
        (workArea.y + workArea.height)) <= 1;
    return {
        left: onLeft ? outerGaps : innerGaps / 2,
        top: onTop ? outerGaps : innerGaps / 2,
        right: onRight ? outerGaps : innerGaps / 2,
        bottom: onBottom ? outerGaps : innerGaps / 2,
    };
}

// Pixel rect for a window inside a tile, gaps applied.
export function tileWindowRect(tile, workArea, innerGaps, outerGaps) {
    const rect = tileToRect(tile, workArea);
    const gaps = tileGaps(rect, workArea, innerGaps, outerGaps);
    return {
        x: Math.round(rect.x + gaps.left),
        y: Math.round(rect.y + gaps.top),
        width: Math.max(1, Math.round(rect.width - gaps.left - gaps.right)),
        height: Math.max(1, Math.round(rect.height - gaps.top - gaps.bottom)),
    };
}

// Nearest tile whose center lies strictly in the given direction.
export function findTileInDirection(tiles, workArea, fromRect, direction) {
    const fx = fromRect.x + fromRect.width / 2;
    const fy = fromRect.y + fromRect.height / 2;
    let best = null;
    let bestDist = Infinity;
    for (const tile of tiles) {
        const rect = tileToRect(tile, workArea);
        const dx = rect.x + rect.width / 2 - fx;
        const dy = rect.y + rect.height / 2 - fy;
        const inDirection =
            direction === 'left' ? dx < -1 :
            direction === 'right' ? dx > 1 :
            direction === 'up' ? dy < -1 :
            direction === 'down' ? dy > 1 : false;
        if (!inDirection)
            continue;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            best = tile;
        }
    }
    return best;
}

// Tile containing a point (pixel coords), or null.
export function tileAtPoint(tiles, workArea, x, y) {
    for (const tile of tiles) {
        const rect = tileToRect(tile, workArea);
        if (x >= rect.x && x <= rect.x + rect.width &&
            y >= rect.y && y <= rect.y + rect.height)
            return tile;
    }
    return null;
}

// Union of two fractional tiles.
export function unionTiles(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x, y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    };
}

export function tilesEqual(a, b) {
    return Math.abs(a.x - b.x) < 0.001 &&
        Math.abs(a.y - b.y) < 0.001 &&
        Math.abs(a.width - b.width) < 0.001 &&
        Math.abs(a.height - b.height) < 0.001;
}
