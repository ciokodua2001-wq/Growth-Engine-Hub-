import { randomUUID } from "crypto";
import { supabaseAdmin as supabase } from "./supabaseClient";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
  type StorageObjectRef,
} from "./objectAcl";

/**
 * Object storage now runs on Supabase Storage (via the shared service-role
 * client in ./supabaseClient), replacing the previous GCS client which
 * authenticated through Replit's local sidecar (127.0.0.1:1106) — that
 * endpoint only exists inside a Replit container, so it could never have
 * worked once self-hosted.
 */

/** Identifies an object by bucket + path within that bucket. */
export type StorageObjectHandle = StorageObjectRef;

/**
 * Thin compatibility shim over the Supabase Storage SDK, shaped like the
 * subset of the old `@google-cloud/storage` API this codebase actually used
 * (`.bucket(name).file(path).save(buffer, opts)`). Kept so the handful of
 * call sites elsewhere in api-server (ffmpegAssembler, sceneManager,
 * videoRenderPipeline, klingRenderer, googleNarrator, images.ts,
 * assemble.ts) don't need to change.
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
            const { error } = await supabase.storage
              .from(bucketName)
              .upload(objectName, buffer, {
                contentType: opts?.metadata?.contentType,
                upsert: true,
              });
            if (error) {
              throw new Error(`Supabase Storage upload failed: ${error.message}`);
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
  const lastSlash = objectName.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : objectName.slice(0, lastSlash);
  const name = lastSlash === -1 ? objectName : objectName.slice(lastSlash + 1);
  const { data, error } = await supabase.storage.from(bucketName).list(dir, {
    search: name,
    limit: 1,
  });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
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
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in Supabase Storage " +
          "and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in Supabase Storage " +
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

    const { data, error } = await supabase.storage
      .from(handle.bucketName)
      .download(handle.objectName);
    if (error || !data) {
      throw new ObjectNotFoundError();
    }

    const headers: Record<string, string> = {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };

    return new Response(data, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in Supabase Storage " +
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
   * Normalizes a fully-qualified Supabase Storage public URL
   * (https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/<path>)
   * down to our internal "/objects/<entityId>" form. Non-Supabase paths pass
   * through unchanged, same as the previous GCS-URL handling.
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
  if (method === "PUT") {
    // Note: Supabase's signed upload URLs have a fixed ~2h validity — there is
    // no per-call ttl parameter like GCS had. The caller's ttlSec is accepted
    // for API-compatibility but not enforced here.
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUploadUrl(objectName, { upsert: true });
    if (error || !data) {
      throw new Error(`Failed to create signed upload URL: ${error?.message ?? "unknown error"}`);
    }
    return data.signedUrl;
  }

  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(objectName, ttlSec);
  if (error || !data) {
    throw new Error(`Failed to create signed URL: ${error?.message ?? "unknown error"}`);
  }
  return data.signedUrl;
}
