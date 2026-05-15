const DB_NAME = "gpt-image-2-drafts";
const DB_VERSION = 1;
const GENERATE_KEY = "generateDraft";
const EDIT_KEY = "editDraft";
const OFFLINE_GENERATE_QUEUE_KEY = "offlineGenerateQueue";

type MaskMode = "paint" | "erase";
type MaskTool = "brush" | "erase" | "rect" | "ellipse";

export type GenerateDraft = {
  prompt: string;
  provider: string;
  size: string;
  format: string;
  quality: string;
  n: number;
  updatedAt: number;
};

export type OfflineGenerateDraft = GenerateDraft & {
  id: string;
  createdAt: number;
  reason?: string;
};

type StoredRef = {
  id: string;
  name: string;
  type: string;
  assetId: string;
};

type StoredEditDraft = {
  editMode: "reference" | "region";
  prompt: string;
  provider: string;
  size: string;
  format: string;
  quality: string;
  n: number;
  refs: StoredRef[];
  selectedRef: string | null;
  targetRefId: string | null;
  brushSize: number;
  maskMode: MaskMode;
  maskTool?: MaskTool;
  maskSnapshots: Record<string, string>;
  updatedAt: number;
};

export type EditDraftRef = {
  id: string;
  name: string;
  url: string;
  file: File;
};

export type EditDraftInput = Omit<
  StoredEditDraft,
  "refs" | "maskSnapshots" | "updatedAt"
> & {
  refs: Array<{ id: string; name: string; file: File }>;
  maskSnapshots: Record<string, string>;
};

export type RestoredEditDraft = Omit<
  StoredEditDraft,
  "refs" | "maskSnapshots"
> & {
  refs: EditDraftRef[];
  maskSnapshots: Record<string, string>;
};

type KvRecord<T> = {
  key: string;
  value: T;
};

type AssetRecord = {
  id: string;
  blob: Blob;
};

const dbPromise = { current: null as Promise<IDBDatabase> | null };

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function openDb() {
  if (!dbPromise.current) {
    dbPromise.current = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("kv")) {
          db.createObjectStore("kv", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("assets")) {
          db.createObjectStore("assets", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise.current;
}

async function readKv<T>(key: string) {
  const db = await openDb();
  const tx = db.transaction("kv", "readonly");
  const record = await requestToPromise<KvRecord<T> | undefined>(
    tx.objectStore("kv").get(key),
  );
  return record?.value ?? null;
}

async function writeKv<T>(key: string, value: T) {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put({ key, value });
  await transactionDone(tx);
}

async function writeAsset(id: string, blob: Blob) {
  const db = await openDb();
  const tx = db.transaction("assets", "readwrite");
  tx.objectStore("assets").put({ id, blob } satisfies AssetRecord);
  await transactionDone(tx);
}

async function readAsset(id: string) {
  const db = await openDb();
  const tx = db.transaction("assets", "readonly");
  const record = await requestToPromise<AssetRecord | undefined>(
    tx.objectStore("assets").get(id),
  );
  return record?.blob ?? null;
}

function closeDb() {
  void dbPromise.current?.then((db) => db.close()).catch(() => undefined);
  dbPromise.current = null;
}

function deleteDatabase() {
  closeDb();
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function dataUrlToBlob(value: string) {
  return fetch(value).then((response) => response.blob());
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function saveGenerateDraft(
  draft: Omit<GenerateDraft, "updatedAt">,
) {
  await writeKv(GENERATE_KEY, { ...draft, updatedAt: Date.now() });
}

export function loadGenerateDraft() {
  return readKv<GenerateDraft>(GENERATE_KEY);
}

export async function enqueueOfflineGenerateDraft(
  draft: Omit<GenerateDraft, "updatedAt">,
  reason?: string,
) {
  const queue = (await readKv<OfflineGenerateDraft[]>(
    OFFLINE_GENERATE_QUEUE_KEY,
  )) ?? [];
  const now = Date.now();
  const next = [
    ...queue,
    {
      ...draft,
      id: `offline-${now}-${Math.floor(Math.random() * 100_000)}`,
      createdAt: now,
      updatedAt: now,
      reason,
    },
  ].slice(-20);
  await writeKv(OFFLINE_GENERATE_QUEUE_KEY, next);
  return next.length;
}

export function loadOfflineGenerateDrafts() {
  return readKv<OfflineGenerateDraft[]>(OFFLINE_GENERATE_QUEUE_KEY).then(
    (queue) => queue ?? [],
  );
}

export async function removeOfflineGenerateDraft(id: string) {
  const queue = (await loadOfflineGenerateDrafts()).filter(
    (draft) => draft.id !== id,
  );
  await writeKv(OFFLINE_GENERATE_QUEUE_KEY, queue);
  return queue;
}

export async function saveEditDraft(draft: EditDraftInput) {
  const refs: StoredRef[] = [];
  for (const ref of draft.refs) {
    const assetId = `ref:${ref.id}`;
    await writeAsset(assetId, ref.file);
    refs.push({
      id: ref.id,
      name: ref.name,
      type: ref.file.type || "image/png",
      assetId,
    });
  }

  const maskSnapshots: Record<string, string> = {};
  for (const [id, dataUrl] of Object.entries(draft.maskSnapshots)) {
    if (!dataUrl) continue;
    const assetId = `mask:${id}`;
    await writeAsset(assetId, await dataUrlToBlob(dataUrl));
    maskSnapshots[id] = assetId;
  }

  await writeKv<StoredEditDraft>(EDIT_KEY, {
    ...draft,
    refs,
    maskSnapshots,
    updatedAt: Date.now(),
  });
}

export async function loadEditDraft(): Promise<RestoredEditDraft | null> {
  const draft = await readKv<StoredEditDraft>(EDIT_KEY);
  if (!draft) return null;
  const refs: EditDraftRef[] = [];
  for (const ref of draft.refs) {
    const blob = await readAsset(ref.assetId);
    if (!blob) continue;
    const file = new File([blob], ref.name, {
      type: blob.type || ref.type || "image/png",
    });
    refs.push({
      id: ref.id,
      name: ref.name,
      file,
      url: URL.createObjectURL(file),
    });
  }

  const maskSnapshots: Record<string, string> = {};
  for (const [id, assetId] of Object.entries(draft.maskSnapshots)) {
    const blob = await readAsset(assetId);
    if (blob) maskSnapshots[id] = await blobToDataUrl(blob);
  }

  return { ...draft, refs, maskSnapshots };
}

export function clearCreativeDrafts() {
  return deleteDatabase();
}
