import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { InsertionIndexableFileReference, SearchIndexableFileReference } from "../types/pdf-file-reference";
import { plainTextPagesToPlainText, rawLinesToPlainTextPages } from "../utils/raw-lines-to-plain-text";
import { readPdfText as _readPdfText } from "pdf-text-reader";
import { singletonOcrRef } from "../utils/ocr";

interface FileDBModel {
  id: number;
  path: string;
  hash: string;
  mimeType: string;
  // serialized text content that can be the raw text or some other format that can be transformed into text
  textContent: string;
}

function appendPageNumber(str: string, i: number, length: number) {
  if (length === 1) return str;
  return `${str}-${i + 1}`;
}

export function cacheToIndexableFileReference(
  cache: Omit<FileDBModel, "id">
): SearchIndexableFileReference[] {
  let plainTextContentPages: string[];
  if (cache.mimeType === "application/pdf") {
    plainTextContentPages = rawLinesToPlainTextPages(JSON.parse(cache.textContent));
  } else if (["image/jpeg", "image/png"].includes(cache.mimeType)) {
    plainTextContentPages = [cache.textContent];
  } else {
    plainTextContentPages = [cache.textContent];
  }
  const pagesLength = plainTextContentPages.length;
  return plainTextContentPages.map((page, i) => ({
    id: appendPageNumber(cache.hash, i, pagesLength),
    title: appendPageNumber(cache.path, i, pagesLength),
    content: page,
    mimeType: cache.mimeType,
    parentId: cache.hash,
    listableContent: page,
  })).concat({
    id: cache.hash,
    title: cache.path,
    content: plainTextPagesToPlainText(plainTextContentPages),
    mimeType: cache.mimeType,
    parentId: null,
    listableContent: plainTextContentPages[0]
  });
}

async function readPdfText(data: Buffer) {
  const pages = await _readPdfText(data);
  return pages;
}

export async function indexableFileReferenceToCache(
  cache: InsertionIndexableFileReference
): Promise<Omit<FileDBModel, "id">> {
  const type = cache.mimeType;
  let textSerializedContent: string;
  if (type === "application/pdf") {
    textSerializedContent = await readPdfText(cache.content).then(
      JSON.stringify
    );
  } else if (["image/jpeg", "image/png"].includes(type)) {
    const worker = singletonOcrRef.worker;
    const ocrResult = await worker.recognize(cache.content);
    textSerializedContent = ocrResult.data.text;
  
  } else {
    textSerializedContent = cache.content.toString();
  }
  return {
    path: cache.title,
    hash: cache.id,
    mimeType: type,
    textContent: textSerializedContent,
  };
}

// file path is used to quickly check if the file has been read
// file hash is used to check if the file has been renamed, it is seen as the true unique identifier
export class LibrarianCache {
  db: Database<sqlite3.Database, sqlite3.Statement>;

  constructor(private cachePath: string, private updatePathOnHashMatch = false) {}
  async load() {
    const db = await open({
      filename: this.cachePath,
      driver: sqlite3.Database,
    });

    // create sqlite table with id, path and textContent
    await db.exec(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      textContent TEXT NOT NULL
    )`);

    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS hashIndex ON files (hash)`
    );
    await db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS pathIndex ON files (path)`
    );
    this.db = db;
  }

  async unload() {
    await this.db.close();
  }

  async getByPath(key: string): Promise<SearchIndexableFileReference[]> {
    const query = `SELECT * FROM files WHERE path = ?`;
    const result = await this.db.get<FileDBModel>(query, key);
    if (!result) return null;
    return cacheToIndexableFileReference(result);
  }

  async getByHash(
    hash: string,
    path?: string
  ): Promise<SearchIndexableFileReference[]> {
    const query = `SELECT * FROM files WHERE hash = ?`;
    const result = await this.db.get<FileDBModel>(query, hash);
    if (result && path && result.path !== path) {
      // to detect file renames, we update the path if the hash matches
      if(this.updatePathOnHashMatch)
        await this.db.run(`UPDATE files SET path = ? WHERE hash = ?`, path, hash);
    }
    if (!result) return null;
    return cacheToIndexableFileReference(result);
  }

  async set(value: InsertionIndexableFileReference) {
    const query = `INSERT INTO files (path, hash, textContent, mimeType) VALUES (?, ?, ?, ?)`;
    const fileRefToInsert = await indexableFileReferenceToCache(value);
    await this.db.run(
      query,
      fileRefToInsert.path,
      fileRefToInsert.hash,
      fileRefToInsert.textContent,
      fileRefToInsert.mimeType
    );
    return cacheToIndexableFileReference(fileRefToInsert);
  }

  async unsetByPath(path: string) {
    const query = `DELETE FROM files WHERE path = ?`;
    await this.db.run(query, path);
  }

  unsetByHash(hash: string) {
    const query = `DELETE FROM files WHERE hash = ?`;
    this.db.run(query, hash);
  }

  getCacheStore() {
    return this.db;
  }

  async getGhostKeys(actualKeys: string[]) {
    return await this.db.all(
      `SELECT * FROM files WHERE path NOT IN (?)`,
      actualKeys
    );
  }
}
