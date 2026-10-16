// Chrome/Brave expose the extension API as `chrome`; Firefox/Zen expose the
// same promise-based API as `browser`. Kerosene talks to it through `ext`.
globalThis.ext = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
