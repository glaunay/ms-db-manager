import { start } from "repl";
import vLib = require("./volume");
import * as t from "./cType";
import { logger } from "./logger";
import { inspect } from "util";
import { timeIt, isEmptyObject } from './utils';

const fetch = require('node-fetch');
const readline = require('readline');

let endPointsRegistry: vLib.Volume[] = []; 
let oEndPointsRegistry:{ [name:string]:vLib.Volume };
let CREDS:t.credentials|undefined;
let ROOT:string;
let PREFIX:string;

interface indexTask {
        node: string,
        pid: string,
        changes_done: number,
        database: string,
        design_document: string,
        indexer_pid: string,
        progress: number,
        started_on: number,
        total_changes: number,
        type: 'indexer',
        updated_on: number
}

type taskConstraintKey = "node" | "database" | "design_document";
type taskConstraint = {[ key in taskConstraintKey ]?:string|number} // ...

function isIndexTask(data:any): data is indexTask {
    if(data.hasOwnProperty("type"))
        return data.type === 'indexer'
    return false;
}
/**
 * A function to raise exception in the event of
 * a non successfull actions reported in a couchDB response document
 * 
 * @param {Promise<t.couchResponse>} couchMsg The couch response  Document
 * @returns {Promise<t.couchResponse>} The couch response document not containing errors
 * @memberof DBmanager
 */
async function parseMsg(couchMsg:Promise<t.couchResponse>):Promise<t.couchResponse> {
    logger.debug(`PARSEMSG input type ${typeof(couchMsg)}`);
    try {
        const data:t.couchResponse = await couchMsg;
        if (t.isCouchResponse(data))
            logger.debug(`ok Type ${typeof(data.ok)}`);
        return data;
        
    } catch(e) {
        throw(e)
    }

}

/**
 * Registered provided database and test their connections
 * by querying each of them for a default view.
 * This can take some time if indexation is required
 * 
 * @param {string[]} endPoints names of the databases
 * @param {string} viewNS name of the document storing the view definitions on the database
 * @param {{}} designObject Optional object storing the view definitions
 * @returns {Object} Raw results of the queried views
 * @memberof DBmanager
 */
export async function _registerAllBatch(endPoints:string[], viewNS:string, designObject?:{}, n:number = 1):Promise<any> {
    endPointsRegistry = endPoints.map( (endPoint) => new vLib.Volume(`${PREFIX}/${endPoint}`, endPoint, CREDS) );
    oEndPointsRegistry = {};
    endPointsRegistry.forEach((v:vLib.Volume) => { oEndPointsRegistry[v.name] = v; });

    let results:any[] = new Array(endPoints.length);
    let total = endPoints.length;
    let done = 0;
    let currIndex:number;
    
    function goAsync(it:any[], i:number, total:number, n:number, results:any[], resolveAll:any, rejectAll:any) {
        let _volume = it[i];
        _volume.buildIndex(viewNS, designObject)
        .then((dbHand:{}) => {
            done++;
            results[i] = dbHand;
            logger.debug(`Done: ${done}/${total} [ i_index ${i} :: t_batch ${n}]`);
            if (i + n < total)
                goAsync(it, i + n, total, n, results, resolveAll, rejectAll)
            if (done == total)
                resolveAll(results);
        }).catch((e:any)=>{               
            rejectAll(e);        
        });
    };
  
    return new Promise((resolveAll, rejectAll) => {
      let work = []
      for (currIndex = 0 ; currIndex < (n < total ? n : total) ; currIndex++)
        work.push(goAsync(endPointsRegistry, currIndex, total, n, results, resolveAll, rejectAll));
    });
  }

  function indexBatchFnDecorator(volumes:vLib.Volume[], viewNS:string,  designObject?:{}){
      const fn = async function(){
        let promises = volumes.map((v) => v.buildIndex(viewNS, designObject))
        //await sleep(5000)
        return Promise.all(promises)
      }
      return fn
      
  }

  function sleep(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

 export async function registerAllBatch(endPoints: string[], viewNS:string, designObject?:{},slice_size:number = 2):Promise<any>{

    function slice_endpoints(endPointsRegistry:vLib.Volume[]){
        logger.debug(`slice_endpoints with number ${slice_size}`);
        var slicedEndPointsRegistry:vLib.Volume[][]=[]
        for (var i=0, j=endPointsRegistry.length; i<j; i+= slice_size){
            slicedEndPointsRegistry.push(endPointsRegistry.slice(i, i+slice_size))
        }
        return slicedEndPointsRegistry
    }

    logger.debug("registerAllBatch")
    endPointsRegistry = endPoints.map( (endPoint) => new vLib.Volume(`${PREFIX}/${endPoint}`, endPoint, CREDS) );
    oEndPointsRegistry = {};
    endPointsRegistry.forEach((v:vLib.Volume) => { oEndPointsRegistry[v.name] = v; });
    
    let slicedEndPointsRegistry = slice_endpoints(endPointsRegistry);

    let indexBatchArray = slicedEndPointsRegistry.map((slice) => indexBatchFnDecorator(slice, viewNS, designObject))

    let all_promises = []
    for (let f of indexBatchArray){
        all_promises.push(await f())
        logger.debug("LOOP");
    }

    return Promise.all(all_promises)
    //return indexBatchArray[0]()
 }

/**
 * Init connection to a couchDB daemon
 * 
 * @param {string} dbRoot HTTP endpoint to couchDB server
 * @param {t.credentials} userID admin user and password
 * @returns {Promise}
 * @memberof DBmanager
 */
export async function connect(dbRoot:string, userID?:t.credentials):Promise<any>/*Promise<endPointStats>*/{
    ROOT = dbRoot;
    CREDS = userID;
    PREFIX = `http://${dbRoot}`;
    if (CREDS)
        PREFIX = `http://${CREDS.login}:${CREDS.pwd}@${dbRoot}`;
    try {
        let res = await fetch(PREFIX, {
            method: 'GET'
        });
        return res.json();
    } catch (e) {
        throw (e);
    }
}

/**
 * Get the a list of task matching 
 * provided constraints. eg: a particular database
 * 
 * @param {taskConstraint} constraints A set of constraints
 * @returns {Promise<indexTask[]>} List of task
 * @memberof DBmanager
 */
export async function activeIndexTasks(constraints?:taskConstraint) {
    let _ = await activeTasks();
    const reDatabase = /shards\/[^\/]+\/(.+)\.[\d]+$/;

    logger.silly(`raw tasks Array ${inspect(_)}`);
    let rawTasks:indexTask[] = _.tasks.filter(isIndexTask);
    if (constraints)
        return rawTasks.filter((e:indexTask)=> {
            if (constraints.hasOwnProperty('database')) {
                let m = reDatabase.exec(e.database);
                if (m) { 
                    return m[1] === constraints.database;
                }
            }
                return true;
            });
    return rawTasks;
}

/**
 * Monitor the current active task of the couchDB process
 * using the "/_active_tasks" endpoint
 * 
 * @returns { Promise<{}> } An object with a single "task" key, whose value is a task array
 * @memberof DBmanager
 */
export async function activeTasks() {
    try {
        logger.silly(`${PREFIX + '/_active_tasks'}`);
        let res = await fetch(PREFIX + '/_active_tasks', {
            method: 'GET'
        });
        let _ = await res.text();
        return JSON.parse(`{ "tasks" : ${_}}`);
    } catch (e) {
        throw (e);
    }
}

/**
 * Execute a predefined "organism?key=[SPECIE]" view
 * on all registered databases
 * 
 * @param {string} ns The namespace of the view
 * @param {string} specie The name of the specie 
 * @returns {Promise<t.boundViewInterface[]>} List of resulting views, each wrapped with the database and view names
 * @memberof DBmanager
 */
export async function list(ns:string, specie:string, serial:Boolean=false):Promise<t.boundViewInterface[]> {
    const fnView = serial ? viewSerial : view;
    let spKeyArray:t.View[] = await fnView(ns, 'organisms', {"key":specie});

    return spKeyArray.map((v, i) => {return { vID : 'organisms', 'vNS' : ns, '_' : i, 'source' : endPointsRegistry[i].name, "view" : v };});
}

/**
 * Ranks all species by their number of sgRNAs
 * 
 * @param {string} ns The namespace of the view
 * @returns { {[k:string]:number|string}[] } A sorted List of Object storing specie sgRNA counts
 * @memberof DBmanager
 */
export async function rank(ns:string, serial:Boolean=false):Promise<{[k:string]:number|string}[]> {
    const fnView = serial ? viewSerial : view;

    let spKeyArray:t.View[] = await fnView(ns, `organisms`);
    let _:{[k:string]:number} = {};
    for (const v of spKeyArray) {
        for await ( const vDatum of v.iteratorQuick() ) {
            if ( ! _.hasOwnProperty(vDatum.key) )
                _[vDatum.key] = 0;
            _[vDatum.key]++;
        }
    }
    return Object.keys(_).map((k:string) => { return { 'specie' : k, 'count' : _[k]}; })
        .sort((a,b)=>{ if (a.count < b.count) return -1;
                       if (a.count < b.count) return 1;
                       return 0;
                     });
}

/**
 * Update documents extracted from a view results using provided update function
 *
 * @param {t.boundViewInterface[]} inputs List of view results
 * @param {t.nodePredicateFnType[]} _fn A document update function 
 * @param {Boolean} sync An optional boolean to force indexation after update, default=true
 * @returns { Promise<{}> } A report of the update process
 * @memberof DBmanager
 */
export async function filter(inputs:t.boundViewInterface[], _fn:t.nodePredicateFnType, sync=true) {
    const resp:{[k:string]: any} = {};
    for (let boundView of inputs) {
        if(t.isEmptyBoundViewInterface(boundView))
            continue;
        const oVol:vLib.Volume = oEndPointsRegistry[boundView.source];
        let keys = await boundView.view.mapQuick((d:any) => d.id);
        const syncSpecs = {
            'vNS' : boundView.vNS,
            'vID' : boundView.vID
        };
        resp[boundView.source] = await oVol.updateBulk(keys, _fn, sync?syncSpecs:undefined );
    }
    if (isEmptyObject(resp)) {
        logger.warn("No filter operation performed");
        return;
    }

    logger.info(`filter summary`);
    logger.debug(`${inspect(resp,{depth:5})}`);
    for (let volName in resp) {
        let up_ok   = 0;
        let up_err  = 0;
        let del_ok  = 0;
        let del_err = 0;
        resp[volName].updated.forEach((slice:any) => {
            slice.bulkUpdate.forEach((d:any) => {
                if (d.hasOwnProperty('ok') )
                    up_ok++;
                else
                    up_err++;
            });
        });
        resp[volName].deleted.forEach((slice:any) => {
            slice.bulkUpdate.forEach((d:any) => {
                if (d.hasOwnProperty('ok') )
                    del_ok++;
                else
                    del_err++;
            });
        });
        logger.info(`filter [${volName}]\t updated (ok/err): ${up_ok}/${up_err} || deleted (ok/err): ${del_ok}/${del_err}`);
    }
    // Log total deletion and volumes report
}

/**
 * Perform a view on a set of databases
 *
 * @param {string} ns The view namespace
 * @param {string} cmd The view (and its evetual parameters) execution command 
 * @returns { Promise<t.viewInterface[]> } A collection of the resulting views
 * @memberof DBmanager
 */
export function view(ns:string, cmd:string, p?:t.viewParameters):Promise<t.View[]> {
    let views:Promise<t.View>[] = endPointsRegistry.map((vol:vLib.Volume)=> vol.view(ns, cmd, p));
    return Promise.all(views);
}

export async function viewSerial(ns:string, cmd:string, p?:t.viewParameters):Promise<t.View[]> {
    logger.info("Performing serial view queries");
    let data:t.View[] = [];
    for (let vol of endPointsRegistry) {
        data.push(await vol.view(ns, cmd, p))
    }

    return data;
}