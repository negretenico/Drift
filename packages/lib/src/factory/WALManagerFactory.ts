import { BrowserWALManager } from "../browermanager/BrowserWALManager";
import { IWALManager } from "../types/types";

export class WALManagerFactory {
  static create(type: string): IWALManager {
    const map = {
      BROWSER: BrowserWALManager.getInstance(),
    };
    return map[type] ?? BrowserWALManager.getInstance();
  }
}
