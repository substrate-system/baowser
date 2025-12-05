export interface LogEntry {
    message:string
    type:'info'|'hash'|'success'|'error'
    timestamp:Date
}

export interface Stats {
    fileSize:number
    chunkSize:number
    chunkCount:number
}
