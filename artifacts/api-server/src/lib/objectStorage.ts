import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
  type StorageObjectRef,
} from "./objectAcl";

/**
 * Object storage is provider-neutral S3 (Wasabi / Cloudflare R2 / AWS S3 / Backblaze
 * B2). Endpoint, region and credentials come from OBJECT_STORAGE_* environment
 * variables so the same code works against any S3-compatible store without code
 * changes. This replaces the previous Supabase Storage (JS SDK) client.
 *
 * Required env vars:
 *   OBJECT_STORAGE_ENDPOINT          e.g. https://s3.ca-central-1.wasabisys.com
 *   OBJECT_STORAGE_REGION            e.g. ca-central-1
 *   OBJECT_STORAGE_ACCESS_KEY_ID     (S3 access key id)
 *   OBJECT_STORAGE_SECRET_ACCESS_KEY (S3 secret access key)
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID (default bucket; also the first path segment
 *                                     convention used by parseObjectPath)
 *
 * Optional:
 *   OBJECT_STORAGE_FORCE_PATH_STYLE  "false" to use virtual-hosted style (default: path style)
 */

/** Identifies an object by bucket + path within that bucket. */
export type StorageObjectHandle = StorageObjectRef;

interface ObjectStorageS3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function getObjectStorageS3Config(): ObjectStorageS3Config {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const region = process.env.OBJECT_STORAGE_REGION;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;

  const missing: string[] = [];
  if (!endpoint) missing.push("OBJECT_STORAGE_ENDPOINT");
  if (!region) missing.push("OBJECT_STORAGE_REGION");
  if (!accessKeyId) missing.push("OBJECT_STORAGE_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("OBJECT_STORAGE_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new Error(`Object storage not configured (missing: ${missing.join(", ")})`);
  }

  return {
    endpoint: endpoint!,
    region: region!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
  };
}

let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3Client) {
    const cfg = getObjectStorageS3Config();
    _s3Client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: cfg.forcePathStyle,
    });
  }
  return _s3Client;
}

function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/**
 * S3 passthrough descriptor for external workers (e.g. Vast.ai video rendering)
 * that upload generated assets directly into our bucket. Returned shape matches
 * the { access_key_id, secret_access_key, endpoint_url, bucket_name, region }
 * contract those workers expect. Credentials are read from env - never logged.
 */
export function getObjectStorageS3Override(): {
  access_key_id: string;
  secret_access_key: string;
  endpoint_url: string;
  bucket_name: string;
  region: string;
} {
  const cfg = getObjectStorageS3Config();
  const bucketName = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketName) {
    throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  }
  return {
    access_key_id: cfg.accessKeyId,
    secret_access_key: cfg.secretAccessKey,
    endpoint_url: cfg.endpoint,
    bucket_name: bucketName,
    region: cfg.region,
  };
}

/**
 * Thin compatibility shim shaped like the subset of the old `@google-cloud/storage`
 * API this codebase actually used (`.bucket(name).file(path).save(buffer, opts)`).
 * Kept so the call sites elsewhere in api-server (ffmpegAssembler, sceneManager,
 * videoRenderPipeline, klingRenderer, googleNarrator, images.ts, assemble.ts)
 * don't need to change.
 */
export const objectStorageClient = {
  bucket(bucketName: string) {
    return {
      file(objectName: string) {
        return {
          async save(
            buffer: Buffer,
            opts?: { metadata?: { contentType?: string } },
          ): Promise<void> {
            try {
              await getS3Client().send(
                new PutObjectCommand({
                  Bucket: bucketName,
                  Key: objectName,
                  Body: buffer,
                  ContentType: opts?.metadata?.contentType,
                }),
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              throw new Error(`Object storage upload failed: ${message}`);
            }
          },
        };
      },
    };
  },
};

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

async function objectExists(bucketName: string, objectName: string): Promise<boolean> {
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: bucketName, Key: objectName }),
    );
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in object storage " +
          "and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in object storage " +
          "and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<StorageObjectHandle | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      if (await objectExists(bucketName, objectName)) {
        return { bucketName, objectName };
      }
    }

    return null;
  }

  async downloadObject(handle: StorageObjectHandle, cacheTtlSec: number = 3600): Promise<Response> {
    const aclPolicy = await getObjectAclPolicy(handle);
    const isPublic = aclPolicy?.visibility === "public";

    let obj: GetObjectCommandOutput;
    try {
      obj = await getS3Client().send(
        new GetObjectCommand({ Bucket: handle.bucketName, Key: handle.objectName }),
      );
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError();
      throw err;
    }

    const body = obj.Body as unknown as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    const bytes = body && typeof body.transformToByteArray === "function"
      ? await body.transformToByteArray()
      : new Uint8Array(0);
    const contentType = obj.ContentType || "application/octet-stream";

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };

    return new Response(Buffer.from(bytes), { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in object storage " +
          "and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<StorageObjectHandle> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    if (!(await objectExists(bucketName, objectName))) {
      throw new ObjectNotFoundError();
    }
    return { bucketName, objectName };
  }

  /**
   * Normalizes a fully-qualified public object URL down to our internal
   * "/objects/<entityId>" form. S3-compatible public URLs (when a bucket is
   * public) are of the form https://<endpoint>/<bucket>/<path>; non-matching
   * paths pass through unchanged. Private buckets (the Wasabi default) are
   * served via presigned URLs and never hit this path.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    const marker = "/storage/v1/object/public/";
    const markerIdx = rawPath.indexOf(marker);
    if (!rawPath.startsWith("http") || markerIdx === -1) {
      return rawPath;
    }

    const rawObjectPath = rawPath.slice(markerIdx + marker.length);

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const handle = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(handle, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectRef,
    requestedPermission,
  }: {
    userId?: string;
    objectRef: StorageObjectHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectRef,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

export async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const s3 = getS3Client();
  const command =
    method === "PUT"
      ? new PutObjectCommand({ Bucket: bucketName, Key: objectName })
      : method === "DELETE"
        ? new DeleteObjectCommand({ Bucket: bucketName, Key: objectName })
        : method === "HEAD"
          ? new HeadObjectCommand({ Bucket: bucketName, Key: objectName })
          : new GetObjectCommand({ Bucket: bucketName, Key: objectName });

  // SigV4 presigned URLs are valid for at most 7 days.
  const expiresIn = Math.max(1, Math.min(ttlSec, 604800));
  return getSignedUrl(s3, command, { expiresIn });
}
