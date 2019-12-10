
export interface delConstraints {
    organisms : string[]
}

export interface endPointStat {[organism : string] : number}
export interface endPointStats { [endpointID : string] : endPointStat }
