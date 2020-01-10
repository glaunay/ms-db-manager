import program = require ("commander");
import { logger, muteLogger, setLogLevel, setFile, logLvl } from "./logger";
import { inspect } from 'util';
import { start, getTasks } from './activeTask';
import multiBar = require("./taskBars");

program
  .option("-v, --verbosity <logLevel>", "Set log level (debug, info, success, warning, error, critical)", "info")
  .option("-t, --target <couchDB endpoint>", "URL to couchDB server")
  .option("-o, --output <logFile>", "fpath to the log file", "watcher.log")
  .parse(process.argv);

setLogLevel(program.verbosity);
if (!program.target) {
    logger.fatal("Please specify --target");
    process.exit(0);
}

logger.info("Starting task monitoring");

muteLogger();
setFile({ "level": program.verbosity, "filename" : program.output, options : {flags: 'w'} });

( async () => {
    const url = program.target;
//start('http://wh_agent:couch@localhost:5984');
    multiBar.createTaskBar();
    const taskMonitor = await start(url);
    const taskObjs = []
    if(program.database)
        taskObjs.push(...await getTasks({database : program.database, type : 'indexer'}) );
    else 
        taskObjs.push(...await getTasks({ type : 'indexer' }) );
    logger.debug(`Found ${taskObjs.length} tasks already running`);
    taskObjs.forEach((oTask) =>  multiBar.addTask(oTask) );
    taskMonitor.on("newTask", (oTask:any) => {
        multiBar.addTask(oTask);
    })
})();

