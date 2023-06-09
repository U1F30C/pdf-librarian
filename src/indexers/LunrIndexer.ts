import Lunr from "lunr";
import { fileExists, readFile, writeFile } from "fs-safe";
import { LibrarianCache } from "../cache/cache";
import { PdfFileReference } from "../types/pdf-file-reference";
import { BaseIndexer } from "./BaseIndexer";

export class ElasticlunrIndexer
  implements BaseIndexer<PdfFileReference<string>>
{
  static indexerType = "elasticlunr";
  private lunrIndex: Lunr.Index;
  constructor(private cache: LibrarianCache, private indexPath: string) {
    const lunrIndex = Lunr(function (this) {
      this.ref("id");

      this.field("title");
      this.field("content");
      // TODO: add all items on initialization caur vanilla lunr doesn't support adding them dinamically, it seems :(
      //   this.
    });
    this.lunrIndex = lunrIndex;
  }
  add(item: PdfFileReference) {
    throw new Error("Method not implemented.");
    // if (!this.exists(item.id)) this.lunrIndex.(item);
  }
  remove(id: string) {
    throw new Error("Method not implemented.");
    // this.lunrIndex.remove(id);
  }
  put(id: string, item: PdfFileReference) {
    if (this.exists(id)) this.remove(id);
    this.add(item);
  }
  search(query: string): PdfFileReference[] {
    const results = this.lunrIndex.search(query);
    return results.map((result) => this.cache.get(result.ref));
  }
  exists(id: string): boolean {
    throw new Error("Method not implemented.");
    return false;
    // return this.lunrIndex
  }
  serialize() {
    return JSON.stringify(this.lunrIndex);
  }
  async deserialize(indexJson: string) {
    this.lunrIndex = Lunr.Index.load(JSON.parse(indexJson));
  }
  async load() {
    if (await fileExists(this.indexPath)) {
      this.deserialize(await readFile(this.indexPath));
    }
  }
  async dump() {
    await writeFile(this.indexPath, this.serialize());
  }
}
