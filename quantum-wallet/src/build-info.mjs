// Build identity, shown in Settings. build.mjs rewrites this file at
// build time with the real values (SW generation + git short hash,
// with a trailing "+" when the working tree was dirty). The checked-in
// placeholder keeps dev servers and tests working without a build.
export default Object.freeze({ version: 'v12', commit: 'dev', builtAt: null });
