export class LocatorCache {
  private cache: Map<string, string> = new Map();

  set(ref: string, stableSelector: string): void {
    this.cache.set(ref.toLowerCase(), stableSelector);
  }

  resolve(ref: string): string | null {
    return this.cache.get(ref.toLowerCase()) || null;
  }

  getAll(): Map<string, string> {
    return new Map(this.cache);
  }

  clear(): void {
    this.cache.clear();
  }
}
