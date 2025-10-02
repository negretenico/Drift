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
