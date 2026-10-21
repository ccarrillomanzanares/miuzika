/** Persistencia del proyecto y su historial en IndexedDB (fallback de localStorage). */

import type { Project } from "../../src/core/types.ts";

const DB_NAME = "miuzika-projects";
const STORE_NAME = "state";
const DB_VERSION = 1;

interface StoredState {
  key: "current" | "history";
  value: unknown;
  savedAt: number;
}

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
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return database;
}

function writeState(state: StoredState): Promise<boolean> {
  return openDatabase().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) {
          resolve(false);
          return;
        }
        try {
          const transaction = db.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).put(state);
          transaction.oncomplete = () => resolve(true);
          transaction.onerror = () => resolve(false);
          transaction.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
  );
}

function readState<T>(key: StoredState["key"]): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE_NAME, "readonly");
          const request = transaction.objectStore(STORE_NAME).get(key);
          request.onsuccess = () => {
            const record = request.result as StoredState | undefined;
            resolve((record?.value as T | undefined) ?? null);
          };
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function saveProjectToDb(project: Project | null): Promise<boolean> {
  if (!project) {
    return writeState({ key: "current", value: null, savedAt: Date.now() });
  }
  return writeState({ key: "current", value: project, savedAt: Date.now() });
}

export async function loadProjectFromDb(): Promise<Project | null> {
  const value = await readState<Project>("current");
  return value && value.schemaVersion === 1 ? value : null;
}

export async function saveHistoryToDb(history: Project[]): Promise<boolean> {
  return writeState({ key: "history", value: history, savedAt: Date.now() });
}

export async function loadHistoryFromDb(): Promise<Project[]> {
  const value = await readState<Project[]>("history");
  return Array.isArray(value)
    ? value.filter((entry): entry is Project => Boolean(entry) && entry.schemaVersion === 1)
    : [];
}
