var restify = require('restify');
var bunyan = require('bunyan');

var logger = bunyan.createLogger({
    name: "mantisbt-sync-jira"
});

var server = restify.createServer({
    name: "mantisbt-sync-jira",
    log: logger
});

server.get('/launch/:projectId', function create(req, res, next) {
    logger.info("Staring sync for project %s", req.params.projectId);
    res.send(200);
    return next();
});

server.listen(8080, function () {
    console.log('%s listening at %s', server.name, server.url);
});