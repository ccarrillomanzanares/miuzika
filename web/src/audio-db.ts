/** Persistencia de WAV en IndexedDB (los metadatos siguen en el proyecto). */

export interface StoredAudioAsset {
  id: string;
  name: string;
  durationBeats: number;
  /** WAV original o audio ya renderizado. */
  blob: Blob;
}

const DB_NAME = "miuzika";
const STORE_NAME = "audio-assets";
const DB_VERSION = 2;

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;
  database = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return database;
}

function readAsset<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE_NAME, "readonly");
          const request = run(transaction.objectStore(STORE_NAME));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function writeAsset(run: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
  return openDatabase().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) {
          resolve(false);
          return;
        }
        try {
          const transaction = db.transaction(STORE_NAME, "readwrite");
          run(transaction.objectStore(STORE_NAME));
          transaction.oncomplete = () => resolve(true);
          transaction.onerror = () => resolve(false);
          transaction.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
  );
}

/** Guarda (o reemplaza) un asset. Devuelve false si IndexedDB no está disponible. */
export async function putAudioAsset(asset: StoredAudioAsset): Promise<boolean> {
  return writeAsset((store) => store.put(asset));
}

export async function getAudioAsset(id: string): Promise<StoredAudioAsset | null> {
  return readAsset((store) => store.get(id));
}

export async function listAudioAssets(): Promise<StoredAudioAsset[]> {
  const result = await readAsset((store) => store.getAll());
  return Array.isArray(result) ? (result as StoredAudioAsset[]) : [];
}
