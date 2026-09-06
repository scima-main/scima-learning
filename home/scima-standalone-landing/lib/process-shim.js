// epub-parser.bundle.js bundles a Node `path` polyfill that calls process.cwd()
// as a fallback inside path.resolve(). There's no `process` global in a browser
// extension page, so without this shim that throws "process is not defined" the
// first time an EPUB resolves a relative resource path. cwd() just needs to
// return *some* absolute root — the actual value doesn't matter here, since the
// parser only ever resolves paths relative to each other, never against the
// real filesystem.
window.process = window.process || {
  cwd: function () { return '/'; },
  nextTick: function (fn) { setTimeout(fn, 0); },
  env: {},
  version: '',
  versions: {},
  platform: 'browser'
};
