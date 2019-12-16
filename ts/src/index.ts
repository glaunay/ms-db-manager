import program = require ("commander");
import { logger, setLogLevel, setFile, logLvl } from "./logger";

import DBmanager = require("./manager");
import { inspect } from "util";
import fs = require('fs');
import { timeIt } from "./utils";
import * as t from "./cType";

interface tParameters {
  "login" : string,
  "password" : string,
  "adress": string,
  "port" : number
}

program
  .option("-c, --config <path>", "Load config file")
  .option("-v, --verbosity <logLevel>", "Set log level (debug, info, success, warning, error, critical)")
  .option("-w, --watch", "Run couchDB task watcher")
  .option("-t --target <targetsOpt>", "Target databases specified as comma-separated list or regexp", parseEndpoints)
  .option("-d, --design <pathToFile>", "Design Document containing views definitions")
  .option("-o, --output <logFile>", "fpath to the log file")
  .option("-n, --namespace <ViewNameSpace>", "Name of the database the set or read view definitions", "vNS")
  .option("-l, --find <specie>", "Specie to list sgRNA")
  .option("-r, --rank <jsonOutputFile>", "Rank species by sgRNA counts in specified json File")
  .option("-r, --remove <specie>", "Specie to delete sgRNA")
  .parse(process.argv);


const logLevel:logLvl = program.verbosity ? program.verbosity : 'info';
if (program.output) {
  setFile({ "level": logLevel, "filename" : program.output, options : {flags: 'w'} });
  setLogLevel('info')
} else {
  setLogLevel(logLevel);
}

logger.info("\t\t***** Starting CRISPR databases manager MicroService *****\n");


(async () => {
  try {

    let parameters:tParameters = {
      "login" : "default",
      "password" : "default",
      "adress": "localhost",
      "port" : 5984
    };
    parameters = program.config ? await parseConfig(program.config, parameters) : parameters;
    
    let res = await DBmanager.connect(`${parameters.adress}:${parameters.port}`,
                                       {'login' : parameters.login, 'pwd' : parameters.password});
    logger.debug(`${inspect(res)}`);
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
  try {  
    const t1 = process.hrtime();
    const summary = await DBmanager.registerAllBatch(dbTarget, viewNS, _doc, 2);
    logger.debug(inspect(summary));
    const t2 = timeIt(t1);
    logger.success(`Total buildIndex done in ${t2[0]}H:${t2[1]}M:${t2[0]}S`);
  } catch(e) {
    logger.fatal(`${e}`);
  }

  if(program.rank)
    await rankSpecies(viewNS, program.rank);
  
    if(program.find)
    await listSpecie(program.find, viewNS);
  
    if(program.remove)
    await deleteSpecie(program.remove, viewNS);
  
})();

/**
 * Rank species found in the database by their sgRNA counts
 * 
 * @param {string} viewNS The namespace (aka:design folder) of the view response  Document
 * @param {string} jsonOutputFile The file to write rankings to.
 */
async function rankSpecies(viewNS:string, jsonOutputFile:string) {
  const report = await DBmanager.rank(viewNS);
  logger.debug(inspect(report, {depth:6}));
  logger.info(`ranks Species: Total ranked  is ${report.length} from ${report[0]} to ${report[report.length -1 ]} sgRNAs`)
  fs.writeFile(jsonOutputFile, JSON.stringify({ 'ranks' : report } ), (err)=> {
    if (err) throw err;
    logger.debug(`Ranks written to ${jsonOutputFile}`);
  });
}

/**
 * List ths sgRNA species found in the database by their sgRNA counts
 * 
 * @param {string} viewNS The namespace (aka:design folder) of the view response  Document
 *
 */
async function listSpecie(specie:string, ns:string) {
  let res;
  try {
    res = await DBmanager.list(ns, specie);
  } catch (e){
    throw new Error(`listSpecie failed ${e}`);
  }
  const total = res.reduce( (acc, cur:t.boundViewInterface)=>  acc + cur.data.rows.length , 0);
  const max   = res.reduce( (acc, cur:t.boundViewInterface)=>  acc > cur.data.rows.length ? acc : cur.data.rows.length , 0);
  const min   = res.reduce( (acc, cur:t.boundViewInterface)=>  acc < cur.data.rows.length  ? acc : cur.data.rows.length , max);
  
  fs.writeFile(`${specie}.json`, JSON.stringify({ 'find' : res } ), (err)=> {
    if (err) throw err;
    logger.debug(`Ranks written to ${specie}.json`);
  });
  logger.success(`listSpecie:A total of ${total} sgRNA were listed in ${res.length} volumes, (min, max) = (${min}, ${max})`);
  return res;
}

/**
 * delete all sgRNA entries of a given specie
 * 
 * @param {string} specie The name of the specie
 * @param {string} viewNS The namespace of the "organims" view used to index sgRNA keys
 */
async function deleteSpecie(specie:string, ns:string) {
  const _fnPredicateGen = function(sp:string) {
    return (k:string, value:any) => {
      if (k === sp) return undefined;
      return value;
    }
  };
  try {
    let res:t.boundViewInterface[] = await listSpecie(specie, ns); 
    let fnPredicate = _fnPredicateGen(specie);
    DBmanager.filter(res, fnPredicate);
  } catch (e){
    logger.fatal(`deleteSpecie failed:\n${e}`);
  }
}

/**
 * Parse the endpoint argument expression 
 * eg: crispr_rc01_v[0-63]
 * 
 * @param {string} _endPoints The expression
 * @returns {string[]} The list of database endpoints
 */
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

/**
 * Parse the design document provided as argument
 * See: https://docs.couchdb.org/en/stable/ddocs/index.html
 * 
 * @param {string} _endPoints The expression
 * @returns {string[]} The list of database endpoints
 */
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

function parseConfig (filePath:string, _default:tParameters):Promise<tParameters>{

  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, fileContents) => {
      if (err) {
        console.error(err)
        return
      }
      try {
        const data = JSON.parse(fileContents)
        for (let k in  _default) {
          if (data.hasOwnProperty(k))
            //@ts-ignore
            _default[k] = data[k];
        }
        logger.debug(`Load configuration:\n${inspect(_default)}`);
        resolve(_default);
      } catch(err) {
        throw new Error(err);
      }
    })
  });
}


//node index.js --batch --verbosity deb ug --design ../views/byOrganism.json
//curl -X POST localhost:5984/test/_bulk_docs -d '{"docs" : [ {"k" : "v", "_rev" : "2-280afe99ffb262c4a326fe28019cca54"}]}' -H"Content-type:application/json"
//curl -X GET 'localhost:5984/crispr_rc01_v35/_design/vNS/_view/organisms?key="Komagataeibacter xylinus E25 GCF_000550765.1"'
//DELETE AGGTTTTGATTTGTAGTTTAGGG
//curl 'localhost:5984/crispr_v10/_design/by_org/_view/organisms?key="Candidatus%20Portiera%20aleyrodidarum%20BT-B-HRs%20GCF_000300075.1"'
//curl -X PUT wh_agent:couch@localhost:5984/crispr_v10/_design/by_org -H "Content-Type : application/json" -d @work/DVL/JS/ms-db-manager/views/byOrganism.json
//curl -X DELETE 'localhost:5984/crispr_v10/AGGTTTTGATTTGTAGTTTAGGG?rev=4-f3551a9b1fa52867a7ea6305ac494f32'
//-->{"ok":true,"id":"AGGTTTTGATTTGTAGTTTAGGG","rev":"5-008d91c666168f62996c296cbc0b4cce"}
