import * as t from "./cType";
import { logger } from "./logger";
import { activeIndexTasks } from "./manager";
import fetch from "node-fetch";
import { inspect } from "util";
import { isObject, isEmptyObject } from './utils';
import { timeIt } from './utils';

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
            let url = this.endpoint;
            logger.debug(`GET:${url}`);
            let res = await fetch(url, {
                method: 'GET'/*,
            body: JSON.stringify(this.wrapBulk(packet)),
            headers: { "Content-Type": "application/json" }
            */
            });
            return res.json(); // Seems a Promise Object
        } catch (e) {
            logger.error(`Can't handshake at ${this.endpoint} reason : ${e}`);
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
        let res =  await fetch(url, {
            method: 'GET'
        });
        let _doc = await res.json();
        if(!_doc.hasOwnProperty("views"))
            throw new Error(`Irregular view design document at [${url}]\n${inspect(_doc)}`);
        return Object.keys(_doc.views)[0];
    }
   
    /**
     * Upload a design document view to the database
     *
     * @param {Object} designObject couchDB design document
     * @param {string} viewNS Name under which the design document will be PUT
     * @memberof Volume
     * @returns {Object} A couchDB response document
     */
    async setIndex(designObject:{}, viewNS:string) {
        logger.debug(`[${this.endpoint}] Setting index`);
        try {
            let url = this.endpoint + `/_design/${viewNS}`;
            logger.debug(`PUT:${url}`);
            let res = await fetch(url, {
                method: 'PUT',
            body: JSON.stringify(designObject),
            headers: { "Content-Type": "application/json" }
            });
            let _ = await res.json();
            if (t.isCouchUpdateConflict(_)) {
                logger.warn(`setIndex: A previous instance of ${viewNS} is found and you provided a design Object`)
                logger.warn(`setIndex: Overwriting content at [${url}]`)
                let _ = await this.mergeAt(`/_design/${viewNS}`, designObject);
                res = await this.setIndex(_, viewNS);
            }   
            return _;
        } catch (e) {
            logger.error(`Can't set view from ${this.endpoint} reason : ${e}`);
            throw(e);
        }
    }
    /**
     * Update the content of the prodided data object with revision attribute of
     * the document found at the provided enpoint.
     * Passed data will be modified.
     * @param {string} docEndPoint currently stored document location
     * @param { {[k:string]:string} } data The object to modify for further insertion
     * @memberof Volume
     * @returns {{[k:string]:string}} The updated document to insert
     */
    async mergeAt(docEndPoint:string, data:{[k:string]:string}) {
        //`/_design/${viewNS}`
        const url = this.endpoint + `/${docEndPoint}`;
        try {
            logger.debug(`mergeAt [GET]${url}`);
            let res = await fetch(url, {
                method: 'GET'
            });
            const _ = await res.json();
            data["_rev"] = _._rev;
        } catch (e) {
            throw new Error(`mergeAt:Unable to fetch document ${url}`);
        }
        logger.debug(`mergeAt: updated as ${inspect(data)}`);
        return data;
    }
    /**
     * Wait for the completion of all database indexation processes   
     * @memberof Volume
     */
    async waitForIndexation(){
        logger.debug(`${this.name} starts waiting for indexation`);

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
     *  GL : Overwriting ??
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
            const triggerKey = await this.defaultViewKey(viewNS);
            logger.debug(`Following key will be used to trigger index building ${triggerKey}`);
            
            let json = await this.view(viewNS, triggerKey);
            const _time = timeIt(time);
            logger.success(`${this.name} buildIndex in ${_time[0]}H:${_time[1]}M:${_time[0]}S`);

            return json;
        } catch (e) {
            throw new Error("build Index failed");
        }
    }

    /**
     * Request a view of the database
     *
     * @param {Object} designObject couchDB design document
     * @param {string} ns The namespace under which the view is stored
     * @param {string} ns The name of the view
     * @returns {Promise<t.viewInterface>} The view object
     * @memberof Volume
     */
    async view (ns:string, cmd:string):Promise<t.viewInterface> { // Should typeguard async json response
        const url = this.endpoint + `/_design/${ns}/_view/${cmd}`;      
        logger.debug(`[view]GET:${url}`);
        try {
            let res = await fetch(url, {
                method: 'GET'
            });
            let json = await res.json();
            logger.debug(`${inspect(json)}`)
            if (t.isCouchTimeOut(json)) {
                logger.warn(`view needs indexation [${url}]`);
                await this.waitForIndexation();
                logger.debug(`Pulling index ${this.name}`);
                let resBack = await fetch(url, {
                    method: 'GET'
                });
                json = await resBack.json();
            }
            if(t.isCouchNotFound(json))
                throw new Error(`view::${url} not found`);
            logger.debug(`view[${this.name}@${url}] response:${inspect(json)}`);
            return json;
        } catch (e) {
            logger.error(`Can't get view [${url}]\nfrom ${this.endpoint} reason : ${e}`);
            throw(e);
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
                headers: { "Content-Type": "application/json" }
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
    // docIDs will be consumed
    // WE need TypeGuard on input, at least to detect error
    async * getBulkDoc(docIDs:string[], slice:number=500) : AsyncGenerator<t.couchBulkResponse> {
        let i  = 0;
        while (docIDs.length > 0) {
            i++;
            let reqBody:t.couchBulkQuery = { "docs" : docIDs.splice(0, slice).map((key:string)=> { return { "id" : key };}) };
            try {
                let url = this.endpoint + '/_bulk_get';
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
        throw new Error (`Irregular document pulled ${inspect(json)}`);
    } // Finish this
    async updateBulk(keys:string[], _fn:t.nodePredicateFnType, syncSpecs?:{[k:string]: string}) {

        const _:t.updateBulkReport = {
            'updated' : [], 'deleted' : []
        }
        // Syncing at the slice level   
        for await (const couchBulkResp of this.getBulkDoc(keys)) { 
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
    _updateBulk(stuff:t.couchBulkResponse, fn:t.nodePredicateFnType, allowEmptyObject=true): t.documentInterface[] {
       /*
        const filterInject = (acc:t.documentInterface[], d:t.couchBulkResponseChunk) => {
            return [...acc, ...d.docs.map((e:t.couchBulkResponseItem)=> this.filterDoc(e.ok, fn, allowEmptyObject) )]
            //return d.docs.map((e:t.couchBulkResponseItem)=> this.filterDoc(e.ok, fn, allowEmptyObject) )
        }
        //let x = stuff.results.reduce(filterInject, []);
        */
        let _:(t.documentInterface|undefined)[] = [];
        stuff.results.forEach( (result:t.couchBulkResponseChunk)  => {
            _ = [..._, ...result.docs.map((e:t.couchBulkResponseItem)=> this.updateDoc(e.ok, fn, allowEmptyObject) )];
        });
        return <t.documentInterface[]>_.filter((e:t.documentInterface|undefined) => e);
    }
    // Filter the content of a document by applying predicate function to all its key,value pair 
    // CPU bound may have to spawn it if large document
    async filter(docID:string, fn:t.nodePredicateFnType, allowEmptyObject=true) {
        const srcDoc = await this.getDoc(docID);
        const tgtDoc:t.documentInterface|undefined = this.updateDoc(srcDoc, fn, allowEmptyObject);
    }
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
    
}

//  TROP LONG !!
//curl -X GET 'localhost:5984/crispr_rc01_v35/_design/vNS/_view/organisms?key="Komagataeibacter xylinus E25 GCF_000550765.1"'

//DELETE AGGTTTTGATTTGTAGTTTAGGG

//curl 'localhost:5984/crispr_v10/_design/by_org/_view/organisms?key="Candidatus%20Portiera%20aleyrodidarum%20BT-B-HRs%20GCF_000300075.1"'
//curl -X PUT wh_agent:couch@localhost:5984/crispr_v10/_design/by_org -H "Content-Type : application/json" -d @work/DVL/JS/ms-db-manager/views/byOrganism.json
//curl -X DELETE 'localhost:5984/crispr_v10/AGGTTTTGATTTGTAGTTTAGGG?rev=4-f3551a9b1fa52867a7ea6305ac494f32'
//-->{"ok":true,"id":"AGGTTTTGATTTGTAGTTTAGGG","rev":"5-008d91c666168f62996c296cbc0b4cce"}