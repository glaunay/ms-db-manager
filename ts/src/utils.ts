export function timeIt(time:[number, number]):[number, number, number, number] {
    const diff = process.hrtime(time);
    const h    = diff[0] === 0 ? 0 : Math.floor(diff[0] / 3600);
    const min  = diff[0] === 0 ? 0 : Math.floor(diff[0] / 60);
    return [ h, min, time[0], time[1] ];
}

export function isObject(n:any):Boolean {
    return typeof n === 'object' && n !== null
}

export function isEmptyObject(n:any):Boolean {
    if (isObject(n))
        return Object.keys(n).length === 0;
    return false;
}