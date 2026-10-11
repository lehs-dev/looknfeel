const PREFIX = '[LooknFeel]';

export function log(...args)   { console.log(PREFIX, ...args); }
export function debug(...args) { console.debug(PREFIX, ...args); }
export function warn(...args)  { console.warn(PREFIX, ...args); }
export function error(...args) { console.error(PREFIX, ...args); }
