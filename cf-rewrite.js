// Skill ids that have a prerendered page in this build. scripts/assemble.mjs
// rewrites this line from what actually landed in dist/skills/, so the routing
// and the pages cannot disagree. Left empty the function still works — every id
// goes to the client-rendered template, exactly as it did before prerendering.
var PRERENDERED = [];

// Docs paths that are really a directory with an index.html behind them, rather
// than a flat <name>.html. scripts/assemble.mjs rewrites this line from the
// assembled tree, same as PRERENDERED. Left empty, every link VitePress emits
// still resolves — it only ever links a section index WITH the trailing slash —
// but the bare /docs/<section> form 404s instead of redirecting.
var DOCS_DIRS = [];

function movedTo(location) {
    return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: { location: { value: location } }
    };
}

function handler(event) {
    var req = event.request;
    var uri = req.uri;

    // Skill detail deep-links. Skill ids contain dots (e.g.
    // "dev.heyari.weather"), which the extension heuristic below would misread
    // as a file — so handle first. Known ids go to their own prerendered page;
    // anything published since the last build falls back to the shared
    // client-rendered template, which fetches the skill and renders it.
    if (uri.indexOf('/skills/') === 0) {
        var rest = uri.slice(8); // strip "/skills/"
        if (rest.endsWith('/')) rest = rest.slice(0, -1);
        if (rest !== '' && rest.indexOf('/') === -1 &&
            rest !== 'detail' && rest !== 'index.html') {
            req.uri = PRERENDERED.indexOf(rest) === -1
                ? '/skills/detail/index.html'
                : '/skills/' + rest + '/index.html';
            return req;
        }
    }

    // VitePress `cleanUrls` links pages without an extension but still emits
    // FLAT files (using/getting-started.html, not using/getting-started/
    // index.html), so the directory heuristic below would send every docs page
    // to a key that doesn't exist. Section indexes are the exception — they
    // really are <dir>/index.html and VitePress only ever links them with a
    // trailing slash, so they fall through to the dir-index rule.
    if (uri.indexOf('/docs/') === 0) {
        if (uri.endsWith('.html')) {
            // Pre-cleanUrls links still resolve, because the flat .html files
            // are exactly what's in the bucket. Redirect rather than serve them
            // so one page isn't reachable at two URLs that both return 200.
            var pretty = uri.slice(0, -5);
            if (pretty.endsWith('/index')) pretty = pretty.slice(0, -5);
            return movedTo(pretty);
        }
        if (!uri.endsWith('/') && uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
            // A section index is the one docs path that ISN'T a flat .html.
            // VitePress only ever links it with the trailing slash, so send the
            // bare form there rather than serving the same page at both.
            if (DOCS_DIRS.indexOf(uri) !== -1) return movedTo(uri + '/');
            req.uri = uri + '.html';
            return req;
        }
    }

    if (uri.endsWith('/')) {
        req.uri = uri + 'index.html';
    } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        // No extension in the last segment → directory-style → append index.html.
        req.uri = uri + '/index.html';
    }
    return req;
}
