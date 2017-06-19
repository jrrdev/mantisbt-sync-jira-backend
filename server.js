var restify = require('restify');
var bunyan = require('bunyan');
var util = require("util");

var allConfig = require('./config/param.json');

var logger = bunyan.createLogger({
    name: "mantisbt-sync-jira",
    level: "debug"
});

var server = restify.createServer({
    name: "mantisbt-sync-jira",
    log: logger,
    serializers: {
        req: bunyan.stdSerializers.req
    }
});

function createSubTasks(config, jiraClient, parentKey) {

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
            
            jiraClient.post(config.target.contextroot + '/issue', jiraSubtask, function (err, req, res, obj) {
                if (err) {
                    logger.error(err);
                }
            });
        }
    }
    
    logger.info("End creating subtask for Jira issue %s", parentKey);
}

function pushToJira(config, jiraClient, issue) {

    var jql = util.format('"cf[%s]"~"%s"', config.convert.issueType.mantisCorrelationField, issue.id);
    var query = {
        "jql": jql,
        "startAt": 0,
        "maxResults": 1,
        "fields": [
            "key"
        ]
    };

    logger.debug("Searching existing issue in Jira with id %s (type: %s)", issue.id, config.convert.issueType.mantisCorrelationField);
    jiraClient.post(config.target.contextroot + '/search', query, function(err, req, res, obj) {
        if (err) {
            logger.error('%d -> %j', res.statusCode, res.headers);
            //logger.debug(err);
        } else {
            if (!obj.issues || obj.issues.length == 0) {
            
                var jiraIssue = {
                    "fields": {
                        "project": {
                            "key": config.target.project.key
                        },
                        "issuetype": {
                            "id": config.convert.issueType.id
                        }
                    }
                };
                
                var mapping = config.convert.mapping;
                for (var i = 0; i < mapping.length; i++) {
                    var mappedField = mapping[i];
                    if (mappedField['jiraName']) {
                        var jiraFieldName = mappedField['jiraName'];
                        if (mappedField['mantisName']) {
                            var mantisFieldName = mappedField['mantisName'];
                            var value = issue[mantisFieldName];
                            if (!(typeof value === 'string')) {
                                value = JSON.stringify(value);
                            }
                            jiraIssue['fields'][jiraFieldName] = value;
                        } else if (mappedField['defaultValue']) {
                            jiraIssue['fields'][jiraFieldName] = mappedField['defaultValue'];
                        } else {
                            logger.error("Can't find fieldValue in mapping", JSON.stringify(mappedField));
                        }
                    } else {
                        logger.error("Can't find jira field name in mapping", JSON.stringify(mappedField));
                    }
                }

                logger.info("Creating Jira issue for Mantis %d", issue.id);
                logger.debug("Pushing issue data : %s", JSON.stringify(jiraIssue));
                
                jiraClient.post(config.target.contextroot + '/issue', jiraIssue, function (err, req, res, obj) {
                    if (err) {
                        logger.error(err);
                    } else if (obj.key) {
                        logger.info("Jira issue created : %s", obj.key);
                        createSubTasks(config, jiraClient, obj.key);
                    }
                });
            } else {
                logger.debug("Jira issue already exists");
            }
        }
    });
}

// Function to retrieve the configuration for a given project
function getConfigForProject(projectId) {
    var allProjects = allConfig.projects;
    
    for (var i = 0; i < allProjects.length; i++) {
        var project = allProjects[i];
        if (project.id == projectId) {
            return project;
        }
    }
    
    logger.error("No project found for id %d", projectId);
}

// Function to fetch all active issues in Mantis
function getSourceIssues(config, mantisClient, jiraClient) {

    logger.debug("Retrieving open issues in Mantis");
    var uri = util.format('/bugs/search/findByProjectIdAndStatusIdNotIn?project=%s&status=%d&projection=%s',
        config.source.project.id, 90, "bugDetails");

    mantisClient.get(uri, function (err, req, res, obj) {
        if (err) {
            logger.error(err);
        } else {
            var issues = obj._embedded.bugs;
            for (var i = 0; i < issues.length; i++) {
                var task = issues[i];
                pushToJira(config, jiraClient, task);
            }
        }
    });
}

function synForConfig(config) {

    logger.debug("Creating Mantis REST client for endpoint %s", config['source']['url']);
    var mantisClient = restify.createJsonClient({
            url: config['source']['url'],
            version: '*',
            log: logger
        });

    if (config.source.username) {
        mantisClient.basicAuth(config.source.username, config.source.password);
    }

    logger.debug("Creating Jira REST client for endpoint %s", config.target.url);
    var jiraClient = restify.createJsonClient({
        url: config.target.url,
        version: '*',
        log: logger
    });

    if (config.target.username) {
        jiraClient.basicAuth(config.target.username, config.target.password);
    }

    getSourceIssues(config, mantisClient, jiraClient);
}

server.get('/launch/:projectId', function create(req, res, next) {
    logger.info("Starting sync for project %s", req.params.projectId);
    
    var config = getConfigForProject(req.params.projectId);
    
    if (config) {
        synForConfig(config);
        res.send(200);
        
    } else {
        res.send(500);
    }
    
    return next();
});

server.get('/launchAll', function create(req, res, next) {

    var allProjects = allConfig.projects;
    
    for (var i = 0; i < allProjects.length; i++) {
        var project = allProjects[i];
        logger.info("Starting sync for project %s", project.id);
        
        synForConfig(project);
    }
    
    res.send(200);
    return next();
});

server.listen(8080, function () {
    console.log('%s listening at %s', server.name, server.url);
});
