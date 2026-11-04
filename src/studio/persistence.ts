import { Design, validateDesign } from "./document";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("forma3d-studio", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadRecovery(): Promise<Design | undefined> {
  const db = await database();
  try {
    const data = await new Promise<unknown>((resolve, reject) => {
      const r = db
        .transaction("projects")
        .objectStore("projects")
        .get("recovery");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return data === undefined ? undefined : validateDesign(data);
  } finally {
    db.close();
  }
}
export async function saveRecovery(design: Design): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(validateDesign(design), "recovery");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
