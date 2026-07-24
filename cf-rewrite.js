function handler(event) {
    var req = event.request;
    var uri = req.uri;

    // Skill detail deep-links: /skills/<id> is served by ONE client-rendered
    // template. Skill ids contain dots (e.g. "dev.heyari.weather"), which the
    // extension heuristic below would misread as a file — so handle first.
    if (uri.indexOf('/skills/') === 0) {
        var rest = uri.slice(8); // strip "/skills/"
        if (rest.endsWith('/')) rest = rest.slice(0, -1);
        if (rest !== '' && rest.indexOf('/') === -1 &&
            rest !== 'detail' && rest !== 'index.html') {
            req.uri = '/skills/detail/index.html';
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
