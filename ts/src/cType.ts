
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