export interface A11yRefInfo {
  role: string;
  name: string;
}

export class LocatorCache {
  private domCache: Map<string, string> = new Map();
  private a11yCache: Map<string, A11yRefInfo> = new Map();

  set(ref: string, stableSelector: string): void {
    this.domCache.set(ref.toLowerCase(), stableSelector);
  }

  resolve(ref: string): string | null {
    return this.domCache.get(ref.toLowerCase()) || null;
  }

  setA11y(ref: string, info: A11yRefInfo): void {
    this.a11yCache.set(ref.toLowerCase(), info);
  }

  resolveA11y(ref: string): A11yRefInfo | null {
    return this.a11yCache.get(ref.toLowerCase()) || null;
  }

  getAllDOM(): Map<string, string> {
    return new Map(this.domCache);
  }

  getAllA11y(): Map<string, A11yRefInfo> {
    return new Map(this.a11yCache);
  }

  clear(): void {
    this.domCache.clear();
    this.a11yCache.clear();
  }

  clearTab(): void {
    this.domCache.clear();
    this.a11yCache.clear();
  }
}
