// Convert base64 data URL to Uint8Array
export function base64ToUint8Array (dataUrl:string):Uint8Array {
    const base64 = dataUrl.split(',')[1]
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
}
