import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

/**
 * Object storage. In production this is Cloudflare R2 (S3 API); locally it is
 * MinIO or plain files on disk. Browsers upload and download directly with
 * signed URLs, so file bytes never pass through the API.
 */
export interface Storage {
  presignPut(key: string, contentType: string, expiresSec?: number): Promise<PresignedUpload>;
  presignGet(key: string, opts?: { expiresSec?: number; downloadName?: string }): Promise<string>;
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  getToFile(key: string, filePath: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}

const DEFAULT_EXPIRY = 60 * 60;

/* ---------------- S3-compatible (R2, MinIO, S3) ---------------- */

class S3Storage implements Storage {
  private client: S3Client;
  /** Signs URLs with the endpoint browsers can reach (differs for MinIO in Docker). */
  private publicClient: S3Client;
  private bucket: string;

  constructor() {
    const base = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID!,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      },
    };
    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT });
    this.bucket = config.S3_BUCKET!;
  }

  async presignPut(key: string, contentType: string, expiresSec = 15 * 60) {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.publicClient, cmd, { expiresIn: expiresSec });
    return { url, headers: { 'Content-Type': contentType } };
  }

  async presignGet(key: string, opts: { expiresSec?: number; downloadName?: string } = {}) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.downloadName
        ? `attachment; filename="${opts.downloadName.replace(/"/g, '')}"`
        : undefined,
    });
    return getSignedUrl(this.publicClient, cmd, { expiresIn: opts.expiresSec ?? DEFAULT_EXPIRY });
  }

  async putFile(key: string, filePath: string, contentType: string) {
    const stat = await fs.stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
        ContentLength: stat.size,
      }),
    );
  }

  async getToFile(key: string, filePath: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    await pipeline(res.Body as Readable, createWriteStream(filePath));
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (err: unknown) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string) {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}

/* ---------------- Local disk (development without MinIO) ---------------- */

export function signLocal(parts: string[]): string {
  return createHmac('sha256', config.SESSION_SECRET).update(parts.join('\n')).digest('base64url');
}

export function verifyLocal(parts: string[], sig: string): boolean {
  const expected = Buffer.from(signLocal(parts));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Rejects keys that could escape the storage directory. */
export function safeKey(key: string): string {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error('Invalid storage key');
  }
  return key;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  filePath(key: string) {
    return path.join(this.root, safeKey(key));
  }

  /** URLs are relative, so they work behind the Vite dev proxy and in production alike. */
  private url(method: 'GET' | 'PUT', key: string, expiresSec: number, extra: Record<string, string> = {}) {
    const exp = String(Math.floor(Date.now() / 1000) + expiresSec);
    const ct = extra.ct ?? '';
    const dl = extra.dl ?? '';
    const sig = signLocal([method, key, exp, ct, dl]);
    const qs = new URLSearchParams({ m: method, exp, sig, ...(ct ? { ct } : {}), ...(dl ? { dl } : {}) });
    return `/storage/${key}?${qs.toString()}`;
  }

  async presignPut(key: string, contentType: string, expiresSec = 15 * 60) {
    return { url: this.url('PUT', key, expiresSec, { ct: contentType }), headers: { 'Content-Type': contentType } };
  }

  async presignGet(key: string, opts: { expiresSec?: number; downloadName?: string } = {}) {
    return this.url('GET', key, opts.expiresSec ?? DEFAULT_EXPIRY, opts.downloadName ? { dl: opts.downloadName } : {});
  }

  async putFile(key: string, filePath: string) {
    const dest = this.filePath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(filePath, dest);
  }

  async putStream(key: string, body: Readable, maxBytes: number) {
    const dest = this.filePath(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    let seen = 0;
    const limiter = async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        seen += chunk.length;
        if (seen > maxBytes) throw new Error('Upload exceeds the size limit');
        yield chunk;
      }
    };
    const tmp = `${dest}.part`;
    try {
      await pipeline(body, limiter, createWriteStream(tmp));
      await fs.rename(tmp, dest);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async getToFile(key: string, filePath: string) {
    await fs.copyFile(this.filePath(key), filePath);
  }

  async head(key: string) {
    try {
      const s = await fs.stat(this.filePath(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await fs.rm(this.filePath(key), { force: true });
  }

  async list(prefix: string) {
    const dir = this.filePath(prefix.replace(/\/$/, '') || '.');
    const out: StoredObject[] = [];
    const walk = async (d: string) => {
      let entries: import('node:fs').Dirent[] = [];
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith('.part')) {
          const s = await fs.stat(full);
          out.push({ key: path.relative(this.root, full).split(path.sep).join('/'), size: s.size, lastModified: s.mtime });
        }
      }
    };
    await walk(dir);
    return out;
  }
}

export type { LocalStorage };

export const storage: Storage =
  config.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage(config.localStorageDir);

export const localStorage: LocalStorage | null = storage instanceof LocalStorage ? storage : null;

/* ---------------- Key layout ---------------- */

export const keys = {
  /**
   * users/<owner>/<logical path minus extension>.<random>.<ext>
   * The random part means a replacement never overwrites an object another
   * device may still be streaming; the old object is deleted once replaced.
   */
  file: (ownerId: string, logicalPath: string) => {
    const ext = path.extname(logicalPath);
    const base = logicalPath.slice(0, logicalPath.length - ext.length);
    return `users/${ownerId}/${base}.${randomBytes(6).toString('hex')}${ext}`;
  },
  backup: (stamp: string) => `backups/postgres/${stamp}.sql.gz`,
};
