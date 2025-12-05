import { Transform } from 'node:stream'
import { TransformStream } from 'node:stream/web'
import * as fs from 'node:fs'

export async function encode (buffer:Buffer|Uint8Array, {
    chunkSize
}:{ chunkSize?:number } = {}):Promise<Uint8Array> {

}

export function createEncodeStream ():Transform|TransformStream {

}
