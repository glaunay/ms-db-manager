import { logger } from "./logger";
import { inspect } from "util";
export { View, viewParameters} from "./view";
export { CompactionTask, IndexerTask, taskObjs as taskTypes, activeTaskCompaction as activeTaskDatabase } from "./activeTask";
import  {View} from "./view";

//export type View = View;


export interface couchBulkQueryItem {
   id   : string,
   rev ?: string,
   atts_since ?:string
}

export interface  couchBulkQuery {
    docs : couchBulkQueryItem[]
}

export interface couchBulkResponseItem {
    "ok" : documentInterface
}

export interface couchBulkResponseChunk {
    "id" : string,
    "docs" : couchBulkResponseItem[]
}

export interface  couchBulkResponse {
    "results" : couchBulkResponseChunk[]
}

// TypeGuard needed above, EG:
/*curl -X POST 'localhost:5984/crispr_rc01_v36/_bulk_get' -d '{ "docs" : [ { "id" : "GATAAAAAAATAAAAGTTTCTGAG"}]' -H "Content-Type: application/js(>'-'(>'-(>'-')> curl -X POST 'localhost:5984/crispr_rc01_v36/_bulk_get' -d '{ "docs" : [ { "id" : "GATAAAAAAATAAAAGTTTCTGAG"} ] }' -H "Content-Type: application/json"
{"results": [{"id": "GATAAAAAAATAAAAGTTTCTGAG", "docs": [{"error":{"id":"GATAAAAAAATAAAAGTTTCTGAG","rev":"undefined","error":"not_found","reason":"missing"}}]}]}
(>'-')> curl -X POST 'localhost:5984/crispr_rc01_v36/_bulk_get' -d '{ "docs" : [ { "id" : "GATAAAAAAAAAAAAAAAAACGG"} ] }' -H "Content-Type: application/json"
{"results": [{"id": "GATAAAAAAAAAAAAAAAAACGG", "docs": [{"ok":{"_id":"GATAAAAAAAAAAAAAAAAACGG","_rev":"1-e71c6dea7ca42ff0dc4dd29dad71d3e8","Mycoplasma dispar GCF_000941075.1":{"NZ_CP007229.1":["-(413948,413970)"]}}}]}]}
*/

export interface updateBulkReport { 
    updated : any[], // Should be type as _bulk_docs response
    deleted : any[] //https://docs.couchdb.org/en/stable/api/database/bulk-api.html#updating-documents-in-bulk
}


export interface viewItem {
    id  : string,
    key : string,
    value : number|string
}

export function isViewItem(d:any): d is viewItem {
   
    if ( !(d.hasOwnProperty('id') && d.hasOwnProperty('key') && d.hasOwnProperty('value'))  )
        return false;

    return (    typeof(d.id) == 'string' && typeof(d.key)   == 'string' && 
            (typeof(d.value) == 'string' || typeof(d.value) == 'number') );
}

export interface viewDocInterface {
    total_rows : number,
    offset     : number,
    //rows       : {[k:string]:any}[]
    rows : viewItem[]
}

export function isViewDocInterface(v:any): v is viewDocInterface {
    for (let k in v)
        if (k != 'total_rows' && k != 'offset' && k != 'rows') {
            logger.error("Head error");
            return false; 
        } 
            // overkill
    for (let d of v.rows)
        if ( !isViewItem(d) ) {
            logger.error(`Non valid view item container at : ${inspect(d)}`);
            return false;
        }
    return true;
}
/*
export function isEmptyViewInterface(v:viewInterface) {
    return v.rows.length == 0;
}
*/

export interface boundViewInterface {
    _ : number,
    vNS : string,
    vID : string,
    source : string,
    view : View
}

export function isBoundViewInterface(d:any): d is viewItem {
    if ( !(d.hasOwnProperty('_')    && d.hasOwnProperty('vNS')    &&
           d.hasOwnProperty('vID')  && d.hasOwnProperty('source') &&
           d.hasOwnProperty('view')) )
        return false;
    return ( typeof(d._)   == 'number' && typeof(d.vNS)    == 'string' && 
             typeof(d.vID) == 'string' && typeof(d.source) == 'string' &&
             d.view instanceof View );
}

export function isEmptyBoundViewInterface(v:boundViewInterface) : boolean {
    return v.view.length == 0;
}

export interface delConstraints {
    organisms : string[]
}

export interface credentials {
    login : string, 
    pwd : string
}

export interface endPointStat {[organism : string] : number}

export interface endPointStats { [endpointID : string] : endPointStat }


export interface couchResponse {
    ok: string;
}

export function isCouchResponse(data:{}) : data is couchResponse {
    return data.hasOwnProperty("ok");
}

export interface couchError {
    error: string;
    reason:string;
}

export function isCouchError(data:any): data is couchError{
    return data.hasOwnProperty("error");
}

export interface couchTimeOut extends couchError {
    reason : "The request could not be processed in a reasonable amount of time."
}

export function isCouchTimeOut(data:couchError): data is couchTimeOut {
    if(isCouchError(data)) 
        return data.error === "timeout"
    return false;
}

export interface couchUpdateConflict extends couchError{
    reason : "Document update conflict."
}
export function isCouchUpdateConflict(data:any): data is couchUpdateConflict {
    if(isCouchError(data)) 
        return data.error === "conflict"
    return false;
}

export interface couchNotFound extends couchError {
    reason : "missing"
}

export function isCouchNotFound(data:any): data is couchNotFound {
    if(isCouchError(data)) 
        return data.error === 'not_found'
    return false;
}

export class httpError extends Error{   
    url:string
    code:number

    constructor(msg:string, url:string, code:number){
        super(msg);
        this.url     = url;
        this.code    = code;
    }
}

export class oCouchError extends Error implements couchError{
    error:string
    reason:string
    url?:string
    constructor(message:string, datum:couchError, url?:string) {
        super(message);
        this.error  = datum.error;
        this.reason = datum.reason;
        this.url    = url;
    }
}

export class oCouchUpdateConflictError extends oCouchError {
    constructor(datum:couchError, url?:string) {
        super("document update conflict", datum, url);
    }
}

export class oCouchNotFoundError extends oCouchError {
    constructor(datum:couchError, url?:string) {
        super("document not found", datum, url);
    }
}

export class oCouchTimeOutError extends oCouchError {
    constructor(datum:couchError, url?:string) {
        super("time out request", datum, url);
    }
}

export class oCouchErrorNotDocument extends Error {
    url : string
    doc : {[k:string]:string}
    
    constructor(datum:{[k:string]:string}, url:string) {
        super("wrong document format");
        this.url = url;
        this.doc = datum;
    }
}

export class SetIndexError extends Error {
    database:string
    viewNS:string

    constructor(message:string, database:string, ns:string) {
        super(message);
        this.database = database;
        this.viewNS = ns;
    }
}

export interface documentInterfaceCore {
    '_id' : string,
    '_rev' : string,
}

export interface documentInterface extends documentInterfaceCore {
    [key: string]: any 
}
export function isDocument(data:{}): data is documentInterfaceCore {
    return data.hasOwnProperty("_id") && data.hasOwnProperty("_rev");
}

export function isEmptyDocument(data:{}): Boolean {
    return data.hasOwnProperty("_id") && data.hasOwnProperty("_rev") && Object.keys(data).length == 2;
}

export interface documentViewInterface extends documentInterfaceCore{
    views : { [k:string]:any }
}
export function isDocumentView(data:{}): data is documentViewInterface {
    return isDocument(data) && data.hasOwnProperty("views");
}

export interface nodePredicateFnType { 
    (k:string, value:any) : {[k:string]:any}|undefined
}
