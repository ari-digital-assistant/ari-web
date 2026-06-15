function handler(event) {
    var req = event.request;
    var uri = req.uri;
    if (uri.endsWith('/')) {
        req.uri = uri + 'index.html';
    } else if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        // No file extension in the last path segment → directory-style → append index.html.
        req.uri = uri + '/index.html';
    }
    return req;
}
