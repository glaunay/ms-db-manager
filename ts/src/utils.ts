import { logger } from "./logger";

/**
 * Compute the time passed from a provided process.hrtime() results
 * 
 * @param {[number, number]} time A [second, nanosecond] tuple
 * @returns {[number, number, number, number]} A [hour, minute, second, nanosecond] duration array
 */
export function timeIt(time:[number, number]):[number, number, number, number] {
    const diff = process.hrtime(time);
    const h    = diff[0] === 0 ? 0 : Math.floor(diff[0] / 3600);
    const min  = diff[0] === 0 ? 0 : Math.floor(diff[0] / 60);   
    return [ h, min, diff[0], diff[1] ];
}

export function unixTimeStamp():number {
    const h:unknown = new Date();
    return  Math.floor(<number>h / 1000);
}

export function isObject(n:any):Boolean {
    if (n !== null)
        return false;
    return typeof n === 'object' && ! (n instanceof Array);
}

export function isEmptyObject(n:any):Boolean {
    if (isObject(n))
        return Object.keys(n).length === 0;
    return false;
}

export function union(setA:Set<any>, setB:Set<any>) {
    let _union = new Set(setA)
    for (let elem of setB) {
        _union.add(elem)
    }
    return _union
}

export function intersection(setA:Set<any>, setB:Set<any>) {
    let _intersection = new Set()
    for (let elem of setB) {
        if (setA.has(elem)) {
            _intersection.add(elem)
        }
    }
    return _intersection
}