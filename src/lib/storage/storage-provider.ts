import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getAppConfig } from "@/config/env";
import { createSignedAssetUrl } from "@/lib/auth/security";

export interface StoragePutInput {
  keyPrefix: "uploads" | "assets" | "previews" | "exports";
  fileName: string;
  buffer: Buffer;
  contentType: string;
}

export interface StoragePutOutput {
  storageKey: string;
  byteLength: number;
  sha256: string;
}

export interface StorageProvider {
  putObject(input: StoragePutInput): Promise<StoragePutOutput>;
  getObject(storageKey: string): Promise<Buffer>;
  deleteObject(storageKey: string): Promise<void>;
  getSignedReadUrl(assetIdOrStorageKey: string, expiresInSeconds?: number): Promise<string>;
}

function assertSafeStorageKey(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\0") ||
    !/^[a-zA-Z0-9._\-/]+$/.test(normalized)
  ) {
    throw new Error("Invalid or unsafe storage key rejected (path traversal prevention).");
  }
  return normalized;
}

export class LocalPrivateStorageAdapter implements StorageProvider {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    const config = getAppConfig();
    this.rootDir = path.resolve(process.cwd(), rootDir || config.localStorageRoot);
  }

  private resolveSafePath(storageKey: string): string {
    const safeKey = assertSafeStorageKey(storageKey);
    const resolved = path.resolve(this.rootDir, safeKey);
    const rootWithSep = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;
    if (resolved !== this.rootDir && !resolved.startsWith(rootWithSep)) {
      throw new Error("Storage path traversal blocked.");
    }
    return resolved;
  }

  async putObject(input: StoragePutInput): Promise<StoragePutOutput> {
    const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
    const ext = path.extname(input.fileName).replace(/[^a-zA-Z0-9.]/g, "") || ".bin";
    const uniqueId = crypto.randomBytes(12).toString("hex");
    const dateFolder = new Date().toISOString().slice(0, 10);
    const storageKey = `${input.keyPrefix}/${dateFolder}/${uniqueId}-${sha256.slice(0, 12)}${ext}`;

    const fullPath = this.resolveSafePath(storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.buffer, { mode: 0o600 });

    return {
      storageKey,
      byteLength: input.buffer.byteLength,
      sha256
    };
  }

  async getObject(storageKey: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(storageKey);
    return fs.readFile(fullPath);
  }

  async deleteObject(storageKey: string): Promise<void> {
    try {
      const fullPath = this.resolveSafePath(storageKey);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && stat.isFile()) {
        // Overwrite with zeros before unlinking for secure deletion
        const zeroBuf = Buffer.alloc(Math.min(stat.size, 65536), 0);
        const handle = await fs.open(fullPath, "r+");
        await handle.write(zeroBuf, 0, zeroBuf.length, 0);
        await handle.close();
        await fs.unlink(fullPath);
      }
    } catch {
      // Ignore if already deleted
    }
  }

  async getSignedReadUrl(assetId: string, expiresInSeconds = 3600): Promise<string> {
    return createSignedAssetUrl(assetId, expiresInSeconds);
  }
}

export class S3PrivateStorageAdapter implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const config = getAppConfig();
    this.bucket = config.s3.bucket;
    this.client = new S3Client({
      endpoint: config.s3.endpoint || undefined,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey
      }
    });
  }

  async putObject(input: StoragePutInput): Promise<StoragePutOutput> {
    const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
    const ext = path.extname(input.fileName).replace(/[^a-zA-Z0-9.]/g, "") || ".bin";
    const uniqueId = crypto.randomBytes(12).toString("hex");
    const dateFolder = new Date().toISOString().slice(0, 10);
    const storageKey = assertSafeStorageKey(
      `${input.keyPrefix}/${dateFolder}/${uniqueId}-${sha256.slice(0, 12)}${ext}`
    );

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.buffer,
        ContentType: input.contentType
      })
    );

    return {
      storageKey,
      byteLength: input.buffer.byteLength,
      sha256
    };
  }

  async getObject(storageKey: string): Promise<Buffer> {
    const safeKey = assertSafeStorageKey(storageKey);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safeKey
      })
    );
    if (!response.Body) {
      throw new Error("Empty S3 object body");
    }
    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  async deleteObject(storageKey: string): Promise<void> {
    const safeKey = assertSafeStorageKey(storageKey);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: safeKey
      })
    );
  }

  async getSignedReadUrl(storageKey: string, expiresInSeconds = 3600): Promise<string> {
    const safeKey = assertSafeStorageKey(storageKey);
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: safeKey
    });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }
}

let singletonStorage: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (singletonStorage) return singletonStorage;
  const config = getAppConfig();
  if (config.storageProvider === "s3" && config.s3.accessKeyId) {
    singletonStorage = new S3PrivateStorageAdapter();
  } else {
    singletonStorage = new LocalPrivateStorageAdapter(config.localStorageRoot);
  }
  return singletonStorage;
}
