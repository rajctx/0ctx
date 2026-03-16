import { gzipSync, gunzipSync } from 'zlib';
import type Database from 'better-sqlite3';
import type {
    CheckpointPayloadRecord,
    NodePayloadCompression,
    NodePayloadRecord
} from '../schema';
import { parsePayloadValue } from './helpers';

export function setNodePayloadRecord(
    db: Database.Database,
    nodeId: string,
    contextId: string,
    payload: unknown,
    options: {
        contentType?: string;
        compression?: NodePayloadCompression;
        createdAt?: number;
        updatedAt?: number;
    } = {}
): NodePayloadRecord {
    const contentType = options.contentType ?? 'application/json';
    const compression = options.compression ?? 'gzip';
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const serializedBuffer = Buffer.from(serialized, 'utf8');
    const encoded = compression === 'gzip' ? gzipSync(serializedBuffer) : serializedBuffer;
    const createdAt = options.createdAt ?? Date.now();
    const updatedAt = options.updatedAt ?? Date.now();

    db.prepare(`
      INSERT INTO node_payloads (nodeId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(nodeId) DO UPDATE SET
        contextId = excluded.contextId,
        contentType = excluded.contentType,
        compression = excluded.compression,
        payload = excluded.payload,
        byteLength = excluded.byteLength,
        updatedAt = excluded.updatedAt
    `).run(nodeId, contextId, contentType, compression, encoded, serializedBuffer.length, createdAt, updatedAt);

    return getNodePayloadRecord(db, nodeId)!;
}

export function getNodePayloadRecord(db: Database.Database, nodeId: string): NodePayloadRecord | null {
    const row = db.prepare(`
      SELECT nodeId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt
      FROM node_payloads
      WHERE nodeId = ?
    `).get(nodeId) as {
        nodeId: string;
        contextId: string;
        contentType: string;
        compression: NodePayloadCompression;
        payload: Buffer;
        byteLength: number;
        createdAt: number;
        updatedAt: number;
    } | undefined;
    if (!row) return null;

    const decodedBuffer = row.compression === 'gzip'
        ? gunzipSync(row.payload)
        : Buffer.from(row.payload);
    const parsed = parsePayloadValue(decodedBuffer.toString('utf8'), row.contentType);

    return {
        nodeId: row.nodeId,
        contextId: row.contextId,
        contentType: row.contentType,
        compression: row.compression,
        byteLength: row.byteLength,
        payload: parsed,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

export function setCheckpointPayloadRecord(
    db: Database.Database,
    checkpointId: string,
    contextId: string,
    payload: unknown,
    options: {
        contentType?: string;
        compression?: NodePayloadCompression;
        createdAt?: number;
        updatedAt?: number;
    } = {}
): CheckpointPayloadRecord {
    const contentType = options.contentType ?? 'application/json';
    const compression = options.compression ?? 'gzip';
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const serializedBuffer = Buffer.from(serialized, 'utf8');
    const encoded = compression === 'gzip' ? gzipSync(serializedBuffer) : serializedBuffer;
    const createdAt = options.createdAt ?? Date.now();
    const updatedAt = options.updatedAt ?? Date.now();

    db.prepare(`
      INSERT INTO checkpoint_payloads (checkpointId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(checkpointId) DO UPDATE SET
        contextId = excluded.contextId,
        contentType = excluded.contentType,
        compression = excluded.compression,
        payload = excluded.payload,
        byteLength = excluded.byteLength,
        updatedAt = excluded.updatedAt
    `).run(checkpointId, contextId, contentType, compression, encoded, serializedBuffer.length, createdAt, updatedAt);

    return getCheckpointPayloadRecord(db, checkpointId)!;
}

export function getCheckpointPayloadRecord(
    db: Database.Database,
    checkpointId: string
): CheckpointPayloadRecord | null {
    const row = db.prepare(`
      SELECT checkpointId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt
      FROM checkpoint_payloads
      WHERE checkpointId = ?
    `).get(checkpointId) as {
        checkpointId: string;
        contextId: string;
        contentType: string;
        compression: NodePayloadCompression;
        payload: Buffer;
        byteLength: number;
        createdAt: number;
        updatedAt: number;
    } | undefined;
    if (!row) return null;

    const decodedBuffer = row.compression === 'gzip'
        ? gunzipSync(row.payload)
        : Buffer.from(row.payload);
    const parsed = parsePayloadValue(decodedBuffer.toString('utf8'), row.contentType);

    return {
        checkpointId: row.checkpointId,
        contextId: row.contextId,
        contentType: row.contentType,
        compression: row.compression,
        byteLength: row.byteLength,
        payload: parsed,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
