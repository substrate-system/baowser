/**
 * Types for Bao/BLAKE3 verified streaming
 */

export interface BaoChunk {
  size: number;
  hash: string;
  data: Buffer;
}

export interface BaoEncoding {
  fileSize: number;
  rootHash: string;
  chunkSize: number;
  chunkCount: number;
  chunks: BaoChunk[];
}

export interface BaoMetadata {
  fileSize: number;
  rootHash: string;
  chunkSize: number;
  chunkCount: number;
}

export interface BaoChunkJson {
  size: number;
  hash: string;
  data: string; // base64 encoded
}

export interface BaoEncodingJson {
  fileSize: number;
  rootHash: string;
  chunkSize: number;
  chunkCount: number;
  chunks: BaoChunkJson[];
}

export interface ChunkVerificationEvent {
  index: number;
  size: number;
  hash: string;
  data: Buffer;
}

export interface ProgressEvent {
  received: number;
  total: number;
  percentage: number;
}

export interface DecoderOptions {
  delayMs?: number;
}
