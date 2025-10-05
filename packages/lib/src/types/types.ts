import { WAL } from "../wal/WAL";
export interface WalClient {
  append(content: string): Promise<string>;
  replay(
    eventNum: number,
    processor: (event: string) => Promise<void>
  ): Promise<void>;
  inspect(numberOfEvents: number): Promise<string[]>;
}
export interface WalEntry {
  id: string;
  timestamp: number;
  data: string;
}

export interface IWALManager {
  register(wal: WAL): Promise<void>;
  append(fileName: string, data: string): Promise<void>;
  read(fileName: string): Promise<string>;
  truncate(fileName: string): Promise<void>;
  replay(
    fileName: string,
    count: number,
    processor: (event: string) => Promise<void>
  ): Promise<ReplayResult>;
}

export interface ReplayResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Error[];
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface DurabilityConfig {
  walFileName: string;
  retryConfig?: RetryConfig;
  onEventProcessed?: (event: string, success: boolean) => void;
}

export interface IDurabilityManager {
  append(data: string): Promise<void>;
  read(): Promise<string>;
  replay(
    eventNum: number,
    processor: (event: string) => Promise<void>
  ): Promise<ReplayResult>;
  getEventCount(): Promise<number>;
  isReplayInProgress: boolean;
}
