// Generic R2 helpers (KOK-016 — first R2 consumer in the codebase). Per the architecture decision
// recorded in api/purchasing.ts's header, object access is Worker-proxied (every read/write goes
// through the Worker's own endpoints), NOT S3-style presigned URLs — no new dependency (D-10).
//
// Deliberately tiny and generic, not purchase-specific: other future features that need R2
// (backups, exports) reuse these same functions instead of each rolling their own. `listObjects`/
// `deleteObject` were added for KOK-022 (backups to R2) — the retention sweep needs to enumerate
// and prune old `backups/` objects.

export async function putObject(
  bucket: R2Bucket,
  key: string,
  // ArrayBufferView added for KOK-022: jobs/backup.ts uploads a TextEncoder-encoded Uint8Array
  // directly rather than round-tripping through a fresh ArrayBuffer slice.
  body: ReadableStream | ArrayBuffer | ArrayBufferView,
  contentType: string,
): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType } });
}

export async function getObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/**
 * Lists every object under `prefix`, transparently paging through R2's `truncated`/`cursor`
 * continuation protocol (a single `bucket.list()` call caps out well below what a year of nightly
 * backups could accumulate under `backups/`, so this can't be skipped as "won't matter in
 * practice").
 */
export async function listObjects(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page: R2Objects = await bucket.list({ prefix, cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}
