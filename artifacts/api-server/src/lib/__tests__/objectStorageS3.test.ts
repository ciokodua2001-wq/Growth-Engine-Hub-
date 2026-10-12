import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, getSignedUrlMock } = vi.hoisted(() => {
  // objectAcl -> db imports require DATABASE_URL at import time; provide a dummy.
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/gf_test";
  return {
    sendMock: vi.fn(),
    getSignedUrlMock: vi.fn(),
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send(...args: unknown[]) {
      return sendMock(...args);
    }
  }
  const command = (kind: string) =>
    function (this: Record<string, unknown>, input: Record<string, unknown>) {
      this.kind = kind;
      Object.assign(this, input);
    };
  return {
    S3Client: MockS3Client,
    PutObjectCommand: command("PutObject"),
    GetObjectCommand: command("GetObject"),
    HeadObjectCommand: command("HeadObject"),
    DeleteObjectCommand: command("DeleteObject"),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock("../objectAcl.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../objectAcl.js")>();
  return {
    ...actual,
    // downloadObject reads the ACL policy; stub it so the test stays DB-free.
    getObjectAclPolicy: vi.fn(async () => ({ visibility: "private" as const })),
  };
});

import {
  ObjectNotFoundError,
  ObjectStorageService,
  getObjectStorageS3Override,
  objectStorageClient,
  signObjectURL,
} from "../objectStorage.js";

beforeAll(() => {
  vi.stubEnv("OBJECT_STORAGE_ENDPOINT", "https://s3.ca-central-1.wasabisys.com");
  vi.stubEnv("OBJECT_STORAGE_REGION", "ca-central-1");
  vi.stubEnv("OBJECT_STORAGE_ACCESS_KEY_ID", "AKID");
  vi.stubEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY", "SECRET");
  vi.stubEnv("DEFAULT_OBJECT_STORAGE_BUCKET_ID", "growthforge-media");
});

beforeEach(() => {
  sendMock.mockReset();
  getSignedUrlMock.mockReset();
});

describe("objectStorage S3 adapter", () => {
  it("saves an object via PutObjectCommand", async () => {
    sendMock.mockResolvedValue({});
    await objectStorageClient
      .bucket("growthforge-media")
      .file("private/x.png")
      .save(Buffer.from("hi"), { metadata: { contentType: "image/png" } });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0][0] as {
      kind: string;
      Bucket: string;
      Key: string;
      ContentType?: string;
    };
    expect(cmd.kind).toBe("PutObject");
    expect(cmd.Bucket).toBe("growthforge-media");
    expect(cmd.Key).toBe("private/x.png");
    expect(cmd.ContentType).toBe("image/png");
  });

  it("signs GET and PUT URLs with the correct commands", async () => {
    getSignedUrlMock.mockResolvedValue("https://signed.example/x");

    await signObjectURL({ bucketName: "b", objectName: "k", method: "GET", ttlSec: 60 });
    expect(getSignedUrlMock.mock.calls[0][1].kind).toBe("GetObject");
    expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 60 });

    await signObjectURL({ bucketName: "b", objectName: "k", method: "PUT", ttlSec: 900 });
    expect(getSignedUrlMock.mock.calls[1][1].kind).toBe("PutObject");
  });

  it("downloadObject returns a Response with the object bytes and content type", async () => {
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      ContentType: "image/png",
    });

    const svc = new ObjectStorageService();
    const res = await svc.downloadObject({ bucketName: "b", objectName: "k" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("downloadObject throws ObjectNotFoundError on a missing object", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }),
    );

    const svc = new ObjectStorageService();
    await expect(svc.downloadObject({ bucketName: "b", objectName: "missing" })).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it("getObjectStorageS3Override fails fast when config is incomplete", () => {
    const prev = process.env.OBJECT_STORAGE_ENDPOINT;
    delete process.env.OBJECT_STORAGE_ENDPOINT;
    try {
      expect(() => getObjectStorageS3Override()).toThrow(/OBJECT_STORAGE_ENDPOINT/);
    } finally {
      if (prev !== undefined) process.env.OBJECT_STORAGE_ENDPOINT = prev;
    }
  });
});
