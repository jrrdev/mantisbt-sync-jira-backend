var restify = require('restify');
var bunyan = require('bunyan');
var util = require("util");

var config = require('./param.json');

var logger = bunyan.createLogger({
    name: "mantisbt-sync-jira"
});

var server = restify.createServer({
    name: "mantisbt-sync-jira",
    log: logger
});

var mantisClient = restify.createJsonClient({
    url: config.source.url,
    version: '*',
    log: logger
});

if (config.source.username) {
    mantisClient.basicAuth(config.source.username, config.source.password);
}

var jiraClient = restify.createJsonClient({
    url: config.target.url,
    version: '*',
    log: logger
});

if (config.target.username) {
    jiraClient.basicAuth(config.target.username, config.target.password);
}

function createSubTasks(parentKey) {

    if (config.subTasks && parentKey) {
		logger.info("Creating subtask for Jira issue %s", parentKey);
	
		for (var i = 0; i < config.subTasks.length; i++) {
			var subtask = config.subTasks[i];
            var jiraSubtask = {
                "fields": {
                    "project": {
                        "key": config.target.project.key
                    },
                    "issuetype": {
                        "id": subtask.issueType.id
                    },
                    parent: {
                        "key": parentKey
                    },
                    "summary": subtask.summary,
                    "description": subtask.description,
                    "reporter": config.source.username
                }
            };
			
			logger.info("Creating subtask for Jira issue %s - %s", parentKey, subtask.summary);
			
            jiraClient.post('/jira2/rest/api/2/issue', jiraSubtask, function (err, req, res, obj) {
                if (err) {
                    logger.error(err);
                }
            });
        }
    }
	
	logger.info("End creating subtask for Jira issue %s", parentKey);
}

function pushToJira(issue) {

    var jql = util.format('"cf[10017]" ~ "%s"', issue.id);
    var query = {
        "jql": jql,
        "startAt": 0,
        "maxResults": 1,
        "fields": [
            "key"
        ]
    };

    jiraClient.post('/jira2/rest/api/2/search', query, function (err, req, res, obj) {
        if (err) {
            logger.error(err);
        } else {
            if (!obj.issues || !obj.issues.length) {
			
                var jiraIssue = {
                    "fields": {
                        "project": {
                            "key": config.target.project.key
                        },
                        "issuetype": {
                            "id": config.convert.issueType.id
                        },
                        "summary": issue.summary,
                        "description": issue.description,
                        "reporter": config.source.username,
						"customfield_10017": JSON.stringify(issue.id),
						"customfield_10013": "A renseigner"
                    }
                };

				logger.info("Creating Jira issue for Mantis %d", issue.id);
				
                jiraClient.post('/jira2/rest/api/2/issue', jiraIssue, function (err, req, res, obj) {
                    if (err) {
                        logger.error(err);
                    } else if (obj.key) {
						logger.info("Jira issue created : %s", obj.key);
                        createSubTasks(obj.key);
                    }
                });
            }
        }
    });
}

// Function to fetch all active issues in Mantis
function getSourceIssues() {

    var uri = util.format('/bugs/search/findByProjectIdAndStatusIdNotIn?project=%s&status=%d&projection=%s',
        config.source.project.id, 90, "bugDetails");

    mantisClient.get(uri, function (err, req, res, obj) {
        if (err) {
            logger.error(err);
        } else {
            var issues = obj._embedded.bugs;
			for (var i = 0; i < issues.length; i++) {
				var task = issues[i];
				//console.log("Create issue : " + JSON.stringify(task));
                pushToJira(task);
            }
        }
    });
}

// Function to fetch an issue in Mantis
function getSourceIssue(issueId) {

    var uri = util.format('/bugs/%d?projection=%s', issueId, "bugDetails");

    mantisClient.get(uri, function (err, req, res, obj) {
        if (err) {
            logger.error(err);
        } else if (obj) {
			   logger.info("Pushing issue %d to Jira", issueId);
			   //console.log("Create issue : " + JSON.stringify(obj));
               pushToJira(obj);
        }
    });
}


server.get('/launch/:projectId', function create(req, res, next) {
    logger.info("Staring sync for project %s", req.params.projectId);
    getSourceIssues();
    res.send(200);
    return next();
});

server.get('/launch/issue/:issueId', function create(req, res, next) {
    logger.info("Staring sync for issue %s", req.params.issueId);
    getSourceIssue(req.params.issueId);
    res.send(200);
    return next();
});

server.listen(8080, function () {
    console.log('%s listening at %s', server.name, server.url);
});