export async function access(store, method, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('catch-me-up', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('lectures', { keyPath: 'id' });
      request.result.createObjectStore('notes');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const read = ['get', 'getAll'].includes(method);
      const transaction = db.transaction(store, read ? 'readonly' : 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = value === undefined
        ? objectStore[method]()
        : Array.isArray(value) ? objectStore[method](...value) : objectStore[method](value);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
