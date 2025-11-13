import Debug from '@substrate-system/debug'
const debug = Debug(import.meta.env.DEV)

export function example ():void {
    debug('hello')
}
