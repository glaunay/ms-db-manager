import program = require ("commander");
import { logger, setLogLevel, setFile, logLvl } from "./logger";

import DBmanager = require("./manager");
import { inspect } from "util";
import fs = require('fs');
import { timeIt } from "./utils";
import * as t from "./cType";
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
  .option("-r, --remove <specie>", "Specie to delete sgRNA")
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
  if(! program.target) {
    logger.info("No Target databases specified, exiting");
    process.exit(0);
  }
  const _doc = program.design ? await parseDesign(program.design) : undefined;
  const dbTarget = program.target
  const viewNS = program.namespace;
  if (_doc)
    logger.debug(`Design document content\n${inspect(_doc)}`);
// if (program.batch) {
  try {  
    const t1 = process.hrtime();
    const summary = await DBmanager.registerAllBatch(dbTarget, viewNS, _doc, 2);
    const t2 = timeIt(t1);
    logger.success(`Total buildIndex done in ${t2[0]}H:${t2[1]}M:${t2[0]}S`);
    //logger.info(`Promised\n${inspect(summary, { showHidden: true, depth: 10 })}`);
    //logger.info(summary.length);
  } catch(e) {
    logger.fatal(`${e}`);
  };

  if(program.list)
    await listSpecie(program.list, viewNS);
  if(program.remove)
    await deleteSpecie(program.remove, viewNS);
  
})();

async function listSpecie(specie:string, ns:string) {
  //await DBmanager.view(ns, `organism?key=${specie}`);
  let res;
  try {
    res = await DBmanager.list(ns, specie);
  } catch (e){
    throw new Error(`listSpecie failed ${e}`);
  }
  const total = res.reduce( (acc, cur:t.boundViewInterface)=>  acc + cur.data.total_rows , 0);
  const max   = res.reduce( (acc, cur:t.boundViewInterface)=>  acc > cur.data.total_rows ? acc : cur.data.total_rows , 0);
  const min   = res.reduce( (acc, cur:t.boundViewInterface)=>  acc < cur.data.total_rows ? acc : cur.data.total_rows , max);
  logger.debug(`==><==\n${inspect(res)}`);
  
  logger.success(`A total of ${total} sgRNA were listed in ${res.length} volumes, (min, max) = (${min}, ${max})`);
  logger.debug(`EG:${inspect(res[0].data.rows[0])}`)
  return res;
}

async function deleteSpecie(specie:string, ns:string) {
  const _fnPredicateGen = function(sp:string) {
    return (k:string, value:any) => {
      if (k === sp) return undefined;
      return value;
    }
  };

  //await DBmanager.view(ns, `organism?key=${specie}`);
  try {
    let res:t.boundViewInterface[] = await listSpecie(specie, ns); 
    let fnPredicate = _fnPredicateGen(specie);
    DBmanager.filter(res, fnPredicate);
  } catch (e){
    logger.fatal(`deleteSpecie failed:\n${e}`);
  }
  //return res;
}

function parseEndpoints(_endPoints:string):string[]{
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
