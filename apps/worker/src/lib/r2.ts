// Generic R2 helpers (KOK-016 — first R2 consumer in the codebase). Per the architecture decision
// recorded in api/purchasing.ts's header, object access is Worker-proxied (every read/write goes
// through the Worker's own endpoints), NOT S3-style presigned URLs — no new dependency (D-10).
//
// Deliberately tiny and generic, not purchase-specific: other future features that need R2
// (backups, exports) reuse these same two functions instead of each rolling their own.

export async function putObject(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer,
  contentType: string,
): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType } });
}

export async function getObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}
