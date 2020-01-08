import * as t from "./cType";
import { logger } from "./logger";
import { activeIndexTasks } from "./manager";
import fetch from "node-fetch";
import { inspect } from "util";
import { isObject, isEmptyObject } from './utils';
import { timeIt } from './utils';
import {getView} from './view';


/**
 * Fetching a couchDB documen at provided url
 * Checking for :
 *  404 error
 *  json keys '_rev' and '_id'
 * 
 * @param url The GET url
 * @returns Promise<{[k:string]:string}> The couchDB document
 */

async function getUnwrap(url:string):Promise<t.documentInterfaceCore>{
    const res = await fetch(url, { method: 'GET' });
    let resData;
    try {
        resData = await res.json();
    } catch (e) {
        throw new t.httpError(res.statusText, url, res.status);
    }
    if (t.isCouchNotFound(resData))
        throw new t.oCouchNotFoundError(resData, url);
    if (!t.isDocument(resData))
        throw new t.oCouchErrorNotDocument(resData, url); 
    return resData;
}

async function postPutUnwrap(url:string, data:any, method:string='POST'):Promise<t.couchResponse> {
    const _p = { 
        method: method,
        body: JSON.stringify(data),
        headers:{ "Content-Type": "application/json" }
    };

    logger.debug(`postPutUnwrap:[${inspect(_p)}] ${url}`);
    const res = await fetch(url, _p);
    logger.debug(`postPutUnwrap:HTTPresp ${inspect(res)}`);
    
    let resData;
    try {
        resData = await res.json();
    } catch (e) {
        throw new t.httpError(res.statusText, url, res.status);
    }
    logger.debug(`postPutUnwrap:data ${inspect(resData)}`);
    if (t.isCouchNotFound(resData))
        throw new t.oCouchNotFoundError(resData, url);
    if (t.isCouchUpdateConflict(resData)) 
        throw new t.oCouchUpdateConflictError(resData, url);  
    if (t.isCouchError(resData))
        throw new t.oCouchError("unexpected Error", resData, url);    

    if (!t.isCouchResponse(resData))
        throw new t.oCouchError("Not a valid response", resData, url);
    
    return resData as t.couchResponse;  
}



async function docFetchUnwrap(url:string, data?:any, method:string='POST'):Promise<t.documentInterfaceCore> {
    const _p = data ? { 
        method: method,
        body: JSON.stringify(data),
        headers:{ "Content-Type": "application/json" }
    } : { method: 'GET' };

    logger.debug(`docFetchUnwrap:[${inspect(_p)}] ${url}`);
    const res = await fetch(url, _p);
    logger.debug(`docFetchUnwrap:HTTPresp ${inspect(res)}`);
    
    let resData;
    try {
        resData = await res.json();
    } catch (e) {
        throw new t.httpError(res.statusText, url, res.status);
    }

    if (t.isCouchNotFound(resData))
        throw new t.oCouchNotFoundError(resData, url);
    if (t.isCouchUpdateConflict(resData)) 
        throw new t.oCouchUpdateConflictError(resData, url);  
    if (!t.isDocument(resData))
        throw new t.oCouchErrorNotDocument(resData, url);    

    return resData;  
}



/**
* Object-oriented API for a single couchDB database
* 
* @export
* @class Volume
*/
export class Volume {
    endpoint : string
    name : string
    
    /**
     * Create an instance of a database
     *
     * @param {string} url HTTP endpoints of th database eg: localhosr:5984/my_database
     * @param {string} name Name of the database, usually the last section of its url 
     * @param {t.credentials} userID admin user and password
     * @memberof Volume
     */
    constructor (url:string, name:string, userID?:t.credentials) {
        this.endpoint = url;
        this.name = name;
    }

    /**
     * Checks for the availablity of the database
     * Perfomrs a GET request on its endpoint
     *
     * @returns { Promise<{}> } A couchDB document with database identity tokens 
     * @memberof Volume
     */
    async handshake() {
        try {
            const url = this.endpoint;
            const res = await getUnwrap(url);
        } catch (e) {
            logger.error(`Can't handshake at ${this.endpoint} reason : ${inspect(e)}`);
            throw(e);
        }
    }

    /**
     * Return a valid view name by looking up in a design document of the database
     *
     * @param {string} viewNS name of the design document, use to build the HTTP endpoint
     * @returns {string} The name of the first view encountered
     * @memberof Volume
     */
    async defaultViewKey(viewNS:string){
        const url = this.endpoint + `/_design/${viewNS}`;   
        try {
            const _doc = await getUnwrap(url);   
            if(! t.isDocumentView(_doc))
                throw new Error(`Irregular view design document at [${url}]\n${inspect(_doc)}`);

            return Object.keys(<t.documentViewInterface>_doc.views)[0];
        } catch(e) {
            throw (e);
        }
    
    }
   
    /**
     * Upload a design document view to the database
     *
     * @param {Object} designObject couchDB design document
     * @param {string} viewNS Name under which the design document will be PUT
     * @memberof Volume
     * @returns {Object} A couchDB response document
     */
    async setIndex(designObject:{}, viewNS:string, recordLimit=5):Promise<any> {
        logger.debug(`[${this.endpoint}] Setting index`);
        const url = this.endpoint + `/_design/${viewNS}`;
        try { 
            let resp = await postPutUnwrap(url, designObject, 'PUT'); 
            return resp;
        } catch (e) {
            if (e instanceof t.oCouchUpdateConflictError) {
                logger.warn(`setIndex: A previous instance of ${viewNS} is found and you provided a design Object`)
                logger.warn(`setIndex: Overwriting content at [${url}]`)
                const _ = await this.mergeAt(`/_design/${viewNS}`, designObject);
                let resp;
                try {
                    resp = await this.setIndex(_, viewNS);
                    return resp;
                } catch(e2){
                    logger.error(`Failed to resubmit view from ${this.endpoint} reason : ${e2}`);
                    throw(e);
                }

            } else {
                logger.error(`Can't set view from ${this.endpoint} reason : ${e}`);
                throw(e);
            }
        }
    }
    /**
     * Update the content of the prodided data object with revision attribute of
     * the document found at the provided enpoint.
     * Passed data will be modified.
     * 
     * @param {string} docEndPoint currently stored document location
     * @param { {[k:string]:string} } data The object to modify for further insertion
     * @memberof Volume
     * @returns {{[k:string]:string}} The updated document to insert
     */
    async mergeAt(docEndPoint:string, data:{[k:string]:string}) {
        //`/_design/${viewNS}`
        const url = this.endpoint + `/${docEndPoint}`;
        try {
            const res = await getUnwrap(url);
            data["_rev"] = res._rev;
        } catch (e) {
            throw new Error(`mergeAt:Unable to fetch document ${url}`);
        }
        logger.debug(`mergeAt: updated as ${inspect(data)}`);
        return data;
    }
    /**
     * Wait for the completion of all database indexation processes   
     * 
     * @memberof Volume
     */
    async waitForIndexation(){
        logger.debug(`${this.name} starts waiting for indexation`);
        let bar:any|undefined = undefined;
        //const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        //bar.start(100, 0);
        return new Promise ((resolve, reject) => {
            let asyncIntervals:Boolean[] = [];
            const runAsyncInterval = async (cb:()=>Promise<any>, interval:number, intervalIndex:number) => {
                let data = await cb();
                logger.debug(`${this.name} [Still Waiting] Current Indexation Task is : ${inspect(data)}`);
                
                if (data.length == 0) {
                    logger.debug("WaitForIndexation clearing");
                    clearAsyncInterval(intervalIndex);
                    logger.debug(`Rdy to index pull ${this.name}`);
                    resolve();
                }

                //logger.info(`${inspect(asyncIntervals)}`);
                if (asyncIntervals[intervalIndex]) {
                    setTimeout(() => runAsyncInterval(cb, interval, intervalIndex), interval);
                }
            };
        
            const setAsyncInterval = (cb:()=>Promise<any>, interval:number) => {
                if (cb && typeof cb === "function") {
                    const intervalIndex = asyncIntervals.length;
                    asyncIntervals.push(true);
                    runAsyncInterval(cb, interval, intervalIndex);
                    return intervalIndex;
                } else {
                    throw new Error('Callback must be a function');
                }
            };
        
            const clearAsyncInterval = (intervalIndex:number) => {
                if (asyncIntervals[intervalIndex]) {
                    asyncIntervals[intervalIndex] = false;
                }
            };
            setAsyncInterval(async () => { return await activeIndexTasks({'database' : this.name}); },
                5000);
        });
    }

    /**
     * Trigger the indexation of the first found view under provided namespace
     * Alternatively, a design document defining new view(s) can be provided.
     * 
     * @param {Object} designObject couchDB design document
     * @param {string} ns The namespace under which the view is stored
     * @param {string} ns The name of the view
     * @returns {Promise<t.viewInterface>} The view object
     * @memberof Volume
     */
     async buildIndex(viewNS:string, designObject?:{}) {
        const time = process.hrtime();
        
        logger.debug(`vNS is ${viewNS} and designObject is ${inspect(designObject)}`);

        try {
            if (designObject)
                await this.setIndex(designObject, viewNS);
        } catch(e) {
            throw new t.SetIndexError('volume.setIndex Error', this.name, viewNS);
        }

        try {
            const triggerKey = await this.defaultViewKey(viewNS);
            logger.debug(`Following key will be used to trigger index building "${triggerKey}"`);
            let oView:t.View = await this.view(viewNS, triggerKey);
            const _time = timeIt(time);
            logger.success(`${this.name} buildIndex in ${_time[0]}H:${_time[1]}M:${_time[0]}S`);

            return oView;
        } catch (e) {
           throw(e);
        }
    }

    //async getView (ns:string, cmd:string, limit?:number):Promise<View> {

    /**
     * Request a view of the database
     *
     * @param {Object} designObject couchDB design document
     * @param {string} ns The namespace under which the view is stored
     * @param {string} ns The name of the view
     * @returns {Promise<t.View>} The view object
     * @memberof Volume
     */
    async view(ns:string, vName:string, vParam?:t.viewParameters):Promise<t.View> {     
        const url = this.endpoint + `/_design/${ns}/_view/${vName}`;
        const _vParam:t.viewParameters = vParam ? vParam : { "skip" : 0 } ;
        
        logger.debug(`${this.name}.view :: ${url} with ${inspect(_vParam)}`);
        try {
            const viewObj:t.View = await getView(url, _vParam);
            return viewObj;
        } catch (e) {
            if (e instanceof t.oCouchTimeOutError) {
                logger.warn(`view needs indexation [${url}]`);
                await this.waitForIndexation();
                const viewObj:t.View = await getView(url, _vParam);
                return viewObj;
            }          
            throw (e);
        }
    }

    /**
     * Insert a collection of documents in the database
     *
     * @param {t.documentInterface[]} data The list of document object
     * @param {Boolean} delBool If true, document with only "_rev" and "_id" keys will be deleted. Optional, default=true
     * @returns {Promise<{}>} An Object storing response couchDB document.
     * @memberof Volume
     */
    async bulkInsert(data:t.documentInterface[], delBool:Boolean=false):Promise<any>{
        const body = {
                        "docs" : data.map((d) => { d._deleted = delBool; return d;}) 
                    };
        try {
            const url = `${this.endpoint}/_bulk_docs`;
            const res = await fetch(url, { 
                method: 'POST',
                body: JSON.stringify(body),
                headers:{ "Content-Type": "application/json"}
            });
            let resp = await res.text();
            resp = JSON.parse(`{ "bulkUpdate" : ${resp}}`);
            const errors = resp.bulkUpdate.filter((e:{})=>e.hasOwnProperty("error"));
            if(errors.length > 0) 
                logger.error(`${this.name}: ${resp.bulkUpdate.length} errors in ${ delBool ? "deletion" : "insertion" }`);
            else
                logger.success(`${this.name}: ${resp.bulkUpdate.length} documents successfully ${ delBool ? "deleted" : "inserted" }`)
            return resp;
        } catch (e) {
            throw (e);
        }
    }
    /**
     * Iterate through a collection of requested documents
     * Warning: the provided list will be consumed
     * 
     * @param {string[]} docIDs The list of document identifiers to retrieve
     * @param {number} slice The number of document to query at each request. Optional, defaumt=500
     * @returns {AsyncGenerator<t.couchBulkResponse>} The fetched documents.
     * @memberof Volume
     */
    // GL - docIDs will be consumed. We need TypeGuard on input, at least to detect error
    async * getBulkDoc(docIDs:string[], slice:number=500) : AsyncGenerator<t.couchBulkResponse> {
        let i  = 0;
        while (docIDs.length > 0) {
            i++;
            let reqBody:t.couchBulkQuery = { "docs" : docIDs.splice(0, slice).map((key:string)=> { return { "id" : key };}) };
            try {
                const url = this.endpoint + '/_bulk_get';
                logger.debug(`GET:${url}`);
                let res = await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify(reqBody),
                    headers: { "Content-Type": "application/json" }            
                });
                let data = await res.json(); // Seems a Promise Object
                logger.debug(`getBulkDoc:${inspect(reqBody)}\n${inspect(data)}`);
                yield data;
            } catch (e) {
                logger.error(`Can't _bulk_get at ${this.endpoint} reason : ${e}`);
                throw(e);
            }
        }
    }
    /**
     * Request a single document
     * 
     * @param {string[]} docID The identifier of document to retrieve
     * @returns {Promise<t.documentInterface>} The fetched document.
     * @memberof Volume
     */
    async getDoc(docID:string):Promise<t.documentInterface> {
        let json:any;
        const url = this.endpoint + `/${docID}`;      
        logger.debug(`[view]GET:${url}`);
        try {
            let res = await fetch(url, {
                method: 'GET'
            });
            json = await res.json();
            if (t.isCouchNotFound(json))
                throw new Error(`${docID} not found at ${this.name}`);
            if (t.isDocument(json))
                return json;
        } catch (e) {
            throw new Error(`${this.name} failed to get document at ${docID}`);
        }
        if (t.isCouchNotFound(json)) 
            throw(json);
        throw new Error (`Irregular document pulled ${inspect(json)}`);
    } 
    /**
     * Wrap the update a collection of documents, by:
     *  -Querying their initial state
     *  -Inserting them after modification
     * 
     * @param {string[]} docIDs The identifier of document to retrieve
     * @param {t.nodePredicateFnType} _fn A function to modify document state
     * @param { {[k:string]: string} } syncSpecs Object specifying a view to re-index, Optional.
     * @returns {Promise<t.updateBulkReport>} Object storing couchDB update reports.
     * @memberof Volume
     */
    async updateBulk(docIDs:string[], _fn:t.nodePredicateFnType, syncSpecs?:{[k:string]: string}) {

        const _:t.updateBulkReport = {
            'updated' : [], 'deleted' : []
        }
        // Syncing at the slice level   
        for await (const couchBulkResp of this.getBulkDoc(docIDs)) { 
            const toDel:t.documentInterface[]  = []
            const toKeep:t.documentInterface[] = []
            for( let doc of this._updateBulk(couchBulkResp, _fn) ) {
                if (t.isEmptyDocument(<{}>doc) )
                    toDel.push(doc)
                else
                    toKeep.push(doc)                                            
            }
            _.deleted.push( await this.bulkInsert(toDel, true) );
            _.updated.push( await this.bulkInsert(toKeep) );
            if (syncSpecs) {
                logger.debug(`Syncing [${this.name}] ... for ${toDel.length}/${toKeep.length} deletion/update `);
                const time  = process.hrtime();
                const vSync = await this.view(syncSpecs.vNS, syncSpecs.vID);
                const _time = timeIt(time);
                logger.debug(`filter: syncing of [${this.name}] took ${_time[0]}H:${_time[1]}M:${_time[2]}S`);
            }
        }  
        return _;
    }

    /**
     * Perform the modification of a collection of documents
     * 
     * @param {t.couchBulkResponse[]} stuff The collection of document to modify
     * @param {t.nodePredicateFnType} _fn A function to modify document state
     * @param { Boolean }  allowEmptyObject Keep or delete documents made empty through modification
     * @returns { t.documentInterface[]} The collection of modified documents
     * @memberof Volume
     */
    _updateBulk(stuff:t.couchBulkResponse, fn:t.nodePredicateFnType, allowEmptyObject=true): t.documentInterface[] {
        let _:(t.documentInterface|undefined)[] = [];
        stuff.results.forEach( (result:t.couchBulkResponseChunk)  => {
            _ = [..._, ...result.docs.map((e:t.couchBulkResponseItem)=> this.updateDoc(e.ok, fn, allowEmptyObject) )];
        });
        return <t.documentInterface[]>_.filter((e:t.documentInterface|undefined) => e);
    }

    /**
     * Perform the modification of a single document
     * 
     * @param {t.documentInterface} srcDoc The document to modify
     * @param {t.nodePredicateFnType} fn A function to modify document state
     * @param { Boolean }  allowEmptyObject Keep or delete documents made empty through modification
     * @returns { t.documentInterface|undefined} The document or undefined if allowEmptyObject was false and document empty
     * @memberof Volume
     */
    // Filter the content of a document by applying pseudo-predicate function to all its key,value pair 
    // CPU bound may have to spawn it if large document
    updateDoc(srcDoc:t.documentInterface, fn:t.nodePredicateFnType, allowEmptyObject=true):t.documentInterface|undefined {
        let tgtDoc:t.documentInterface = {
            "_id": srcDoc._id,
            "_rev": srcDoc._rev
        };

        const nodePredicate = fn;
        const _fn = (nodekey:string, nodeContent:any) => {
            logger.silly(`_fn on ${nodekey}`);
            if (!nodePredicate(nodekey, nodeContent)) {
                logger.silly(`${nodekey} failed`);
                return undefined;
            }
            // The current node holds a scalar,
            // It was evaluated at nodePredicate above call
            // Safe to return it
            if ( !isObject(nodeContent) )
                return nodeContent;
            // The current node holds many ones, we have to account for all their k,v
            const node:{[k:string]:any} = {};
            
            for (let k in nodeContent) {
                let _ = _fn(k, nodeContent[k]);
                if(_) { 
                    if (!allowEmptyObject && isEmptyObject(_))
                        continue;
                    node[k] = _;
                }
            }
            if(Object.keys(node).length == 2) 
                return undefined;

            return node;
        }
        for (let key of Object.keys(srcDoc).filter((k:string) => ! k.startsWith('_'))) {
            const _ = _fn(key, srcDoc[key]);
            if(_)
                tgtDoc[key] = _;
        }
        logger.silly(`filterDoc : \n${inspect(srcDoc)}\nbecame\n${inspect(tgtDoc)}`);
        return tgtDoc;
    }

/*
    async filter(docID:string, fn:t.nodePredicateFnType, allowEmptyObject=true) {
        const srcDoc = await this.getDoc(docID);
        const tgtDoc:t.documentInterface|undefined = this.updateDoc(srcDoc, fn, allowEmptyObject);
    }
  */  
}
