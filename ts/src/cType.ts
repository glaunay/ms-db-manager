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
export interface viewInterface {
    total_rows : number,
    offset : number,
    rows : {[k:string]:any}
}

export interface boundViewInterface {
    _ : number,
    vNS : string,
    vID : string,
    source : string,
    data : viewInterface
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
}

export interface couchTimeOut extends couchError {
    error  : "timeout",
    reason : "The request could not be processed in a reasonable amount of time."
}

export function isCouchTimeOut(data:couchError): data is couchTimeOut {
    if(data.hasOwnProperty("error"))
        return data.error === 'timeout'
    return false;
}

export interface couchNotFound extends couchError {
    error  : "not_found",
    reason : "missing"
}

export function isCouchNotFound(data:couchError): data is couchNotFound {
    if(data.hasOwnProperty("error"))
        return data.error === 'not_found'
    return false;
}

export interface documentInterface {
    '_id' : string,
    '_rev' : string,
    [key: string]: any 
}

export function isDocument(data:{}): data is documentInterface {
    return data.hasOwnProperty("_id") && data.hasOwnProperty("_rev");
}

export interface nodePredicateFnType { 
    (k:string, value:any) : {[k:string]:any}|undefined
}
