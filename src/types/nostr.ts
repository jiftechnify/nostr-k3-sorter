import { Event, EventTemplate } from 'nostr-tools';

declare global {
  interface Window {
    nostr: {
      getPublicKey: () => Promise<string>;
      signEvent: (event: EventTemplate) => Promise<Event>;
      getRelays: () => Promise<{ [url: string]: { read: boolean; write: boolean } }>;
    };
  }
}
export {};
