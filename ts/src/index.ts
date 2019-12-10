import program = require ("commander");
import { logger, setLogLevel, setFile, logLvl } from "./logger";

import DBmanager = require("./manager");
import { inspect } from "util";
import fs = require('fs');
import assert = require('assert');
import { prototype } from "events";

//node index.js --batch --verbosity debug --design ../views/byOrganism.json

program
  .option("-c, --config <path>", "Load config file")
  .option("-v, --verbosity <logLevel>", "Set log level (debug, info, success, warning, error, critical)")
  .option("-t, --test", "Run tests of the warehouse")
  .option("-p, --noproxy", "Start the microservice without the proxy (to make curl command working)")
  .option("-w, --watch", "Run couchDB task watcher")
  .option("-b --batch", "blablabla")
  .option("-t --target <targetsOpt>", "Target databases specified as comma-separated list or regexp", parseEndpoints)
  .option("-d, --design <pathToFile>", "Design Document containing views definitions")
  .option("-o, --output <logFile>", "fpath to the log file")
  .option("-n, --namespace <ViewNameSpace>", "Name of the database the set or read view definitions", "vNS")
  .option("-l, --list <specie>", "Specie to list sgRNA")
  .parse(process.argv);


const logLevel:logLvl = program.verbosity ? program.verbosity : 'info';
if (program.output) {
  setFile({ "level": logLevel, "filename" : program.output });
  setLogLevel('info')
} else {
  setLogLevel(logLevel);
}

logger.log("info", "\t\t***** Starting CRISPR databases manager MicroService *****\n");


(async () => {
  try {
    let res = await DBmanager.connect('localhost:5984', {'login' : "wh_agent", 'pwd' : "couch"});
    logger.info(`${inspect(res, true, 3)}`);
  } catch (e) {
    logger.fatal(e);
  }
  if (program.watch) {
      DBmanager._watch();
      return;
  }
  if(! program.target) 
    logger.info("No Target databases specified, exiting");

  const _doc = program.design ? await parseDesign(program.design) : undefined;
  const dbTarget = program.target
  const viewNS = program.namespace;
  if (_doc)
    logger.debug(`Design document content\n${inspect(_doc)}`);
// if (program.batch) {
  try {  
    logger.warn(viewNS);
    const summary = await DBmanager.registerAllBatch(dbTarget, viewNS, _doc, 2);
    logger.info(`Promised\n${inspect(summary, { showHidden: true, depth: 10 })}`);
    logger.info(summary.length);
  } catch(e) {
    logger.fatal(`${e}`);
  };

  if(program.list) {
    let view = await listSpecie(program.list, viewNS);
    logger.info(`${inspect(view)}`)
  } 
})();

async function listSpecie(specie:string, ns:string) {
  //await DBmanager.view(ns, `organism?key=${specie}`);
  let res = await DBmanager.list(ns, specie);
  logger.info(`==><==\n${res}`);
}
function parseEndpoints(_endPoints:string):string[]{
  logger.info('OOO');
  const rangeRegExp=/(\[(\d+)-(\d+)\])/;
  const endPointInject = (acc:string[], cur:string) => {
    const m =rangeRegExp.exec(cur);

    if(!m)
      return [...acc, cur];

    const v = [m[2], m[3]].map((_) => parseInt(_));
    if(v[0] > v[1]) {
      logger.fatal(`Irregular numeric range ${v[0]} ${v[1]}`);
      process.exit(1);
    }
    let numLabels = Array((v[1]-v[0]) + 1).fill(v[0]).map((x,y)=> x + y);
    
    return [ ...acc, ...numLabels.map((v) => cur.replace(/\[\d+-\d+\]/, v)) ]
  }

  return _endPoints.split(',').reduce(endPointInject, []);
}

function parseDesign(filePath:string):Promise<{}>{
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, fileContents) => {
      if (err) {
        console.error(err)
        return
      }
      try {
        const data = JSON.parse(fileContents)
        resolve(data);
      } catch(err) {
        throw new Error(err);
      }
    })
  });
}
//DBmanager.remove();




async function promiseAllBatch(it:any[], n:number = 2):Promise<any> {
  let results:any[] = new Array(it.length);
  let total = it.length;
  let done = 0;
  let currIndex:number;

  function goAsync(it:any[], i:number, total:number, n:number, /*done:number,*/ results:any[], resolveAll:any) {
    let datum = it[i];
    return new Promise((resolve, reject) => {
     
     
      logger.warn(`Launching task ${i} w/ datum ${datum} and timer ${Math.floor(10000/(i+1))}`);
      setTimeout( ( )=> { 
          logger.warn(`Registered ${i} Finishes`); 
          let comp = `R${datum}`;
          resolve([i, comp]);},
        Math.floor(10000/(i+1))
      );
    }).then((_) => {
      done++;
      let v = _ as any[];
      results[v[0]] = v[1];
      logger.debug(`Done: ${done}/${total} [ i_index ${v[0]}, ${i} :: t_batch ${n}]`);
      if (i + n < total)
        goAsync(it, i + n, total, n/*, done*/, results, resolveAll);
      if (done == total)
        resolveAll(results);
    });
  };

  return new Promise((resolveAll, rejectAll) => {
    let work = []
    for (currIndex = 0 ; currIndex < (n < total ? n : total) ; currIndex++)
      work.push(goAsync(it, currIndex, total, n, /*done,*/ results, resolveAll));
    //not working //Promise.all(work).then(()=>{resolveAll(results)});
  });
}