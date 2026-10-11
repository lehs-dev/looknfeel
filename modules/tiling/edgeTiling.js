// Edge tiling: dragging the pointer into a screen-edge zone previews the
// matching tile (halves on edges, quarters in corners). Inspired by Tiling
// Shell's edge tiling by Domenico Ferraro (GPL-3.0-or-later).

const HALF_LEFT = {x: 0, y: 0, width: 0.5, height: 1};
const HALF_RIGHT = {x: 0.5, y: 0, width: 0.5, height: 1};
const HALF_TOP = {x: 0, y: 0, width: 1, height: 0.5};
const HALF_BOTTOM = {x: 0, y: 0.5, width: 1, height: 0.5};
const QUARTERS = [
    {x: 0, y: 0, width: 0.5, height: 0.5},
    {x: 0.5, y: 0, width: 0.5, height: 0.5},
    {x: 0, y: 0.5, width: 0.5, height: 0.5},
    {x: 0.5, y: 0.5, width: 0.5, height: 0.5},
];

export class EdgeTiling {
    // Returns {kind: 'tile', tile} | {kind: 'maximize'} | null.
    update(x, y, workArea, {offset, quarterArea, topMaximize}) {
        const nearLeft = x - workArea.x < offset;
        const nearRight = workArea.x + workArea.width - x < offset;
        const nearTop = y - workArea.y < offset;
        const nearBottom = workArea.y + workArea.height - y < offset;
        if (!nearLeft && !nearRight && !nearTop && !nearBottom)
            return null;
        const inLeft = x - workArea.x < quarterArea;
        const inRight = workArea.x + workArea.width - x < quarterArea;
        const inTop = y - workArea.y < quarterArea;
        const inBottom = workArea.y + workArea.height - y < quarterArea;
        if (nearTop && inLeft)
            return {kind: 'tile', tile: QUARTERS[0]};
        if (nearTop && inRight)
            return {kind: 'tile', tile: QUARTERS[1]};
        if (nearBottom && inLeft)
            return {kind: 'tile', tile: QUARTERS[2]};
        if (nearBottom && inRight)
            return {kind: 'tile', tile: QUARTERS[3]};
        if (nearLeft)
            return {kind: 'tile', tile: HALF_LEFT};
        if (nearRight)
            return {kind: 'tile', tile: HALF_RIGHT};
        if (nearTop)
            return topMaximize ? {kind: 'maximize'} : {kind: 'tile', tile: HALF_TOP};
        if (nearBottom)
            return {kind: 'tile', tile: HALF_BOTTOM};
        return null;
    }
}
