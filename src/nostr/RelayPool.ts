import { Event, Filter, Relay, relayInit, Sub, SubscriptionOptions, utils } from 'nostr-tools';

const makeCancellableWait = (ms: number): { wait: () => Promise<never>; cancelWait: () => void } => {
  let timeoutHandle: number | undefined;

  const wait = () =>
    new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timeoutHandle = undefined;
        reject(Error('timed out!'));
      }, ms);
    });
  const cancelWait = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
  };
  return { wait, cancelWait };
};

const withTimeout = async <T>(asyncFn: () => Promise<T>, timeoutMs: number): Promise<T> => {
  const { wait, cancelWait } = makeCancellableWait(timeoutMs);
  return Promise.race([wait(), asyncFn().finally(() => cancelWait())]);
};

export class RelayPool {
  #availConns: Map<string, Relay>;
  #triedRelays: Set<string>;

  #seenOn: { [id: string]: Set<string> } = {}; // a map of all events we've seen in each relay

  constructor() {
    this.#availConns = new Map();
    this.#triedRelays = new Set();
  }

  async ensureRelays(relayUrls: string[]): Promise<Relay[]> {
    // "wss://"からはじまるURLのみを残し、normalizeする
    const validRelayUrls = relayUrls.filter(u => u.startsWith('wss://')).map(u => utils.normalizeURL(u));
    if (validRelayUrls.length === 0) {
      return [];
    }

    // まだ接続を試行したことがないリレーURLをリストアップ
    const notTriedRelayUrls = validRelayUrls.filter(u => !this.#triedRelays.has(u));
    notTriedRelayUrls.forEach(u => this.#triedRelays.add(u));

    // まだ接続したことがないリレーに接続試行
    if (notTriedRelayUrls.length > 0) {
      console.log('try to connect to relays:', notTriedRelayUrls);
      await Promise.all(
        notTriedRelayUrls.map(url =>
          withTimeout(async () => {
            const relay = relayInit(url);
            try {
              await relay.connect();
              console.log('connected to:', url);
              this.#availConns.set(url, relay);
            } catch {
              throw Error(`failed to connect: ${url}`);
            }
          }, 2000).catch((e: Error) => {
            console.error(`${url}: ${e.message}`);
          })
        )
      );
    }

    return validRelayUrls.filter(u => this.#availConns.has(u)).map(u => this.#availConns.get(u) as Relay);
  }

  async sub(relayUrls: string[], filters: Filter[], opts?: SubscriptionOptions): Promise<Sub> {
    const _knownIds: Set<string> = new Set();
    const modifiedOpts = opts || {};
    modifiedOpts.alreadyHaveEvent = (id, url) => {
      const set = this.#seenOn[id] || new Set();
      set.add(url);
      this.#seenOn[id] = set;
      return _knownIds.has(id);
    };

    // 接続が確立されたリレーのリストを取得
    const availableRelays = await this.ensureRelays(relayUrls);

    const subs: Sub[] = [];
    const eventListeners: Set<(event: Event) => void> = new Set();
    const eoseListeners: Set<() => void> = new Set();

    let eoseSent = false;
    let eosesMissing = availableRelays.length;
    const eoseTimeout = setTimeout(() => {
      eoseSent = true;
      for (const cb of eoseListeners.values()) cb();
    }, 2400);

    for (const relay of availableRelays) {
      const s = relay.sub(filters, modifiedOpts);
      s.on('event', (ev: Event) => {
        _knownIds.add(ev.id);
        for (const cb of eventListeners.values()) cb(ev);
      });
      s.on('eose', () => {
        if (eoseSent) return;

        eosesMissing--;
        if (eosesMissing === 0) {
          clearTimeout(eoseTimeout);
          for (const cb of eoseListeners.values()) cb();
        }
      });
      subs.push(s);
    }

    const poolSub: Sub = {
      sub(filters, opts) {
        subs.forEach(sub => sub.sub(filters, opts));
        return poolSub;
      },
      unsub() {
        subs.forEach(sub => sub.unsub());
      },
      on(type, cb) {
        switch (type) {
          case 'event':
            eventListeners.add(cb as (e: Event) => void);
            break;
          case 'eose':
            eoseListeners.add(cb as () => void);
            break;
        }
      },
      off(type, cb) {
        switch (type) {
          case 'event':
            eventListeners.delete(cb as (e: Event) => void);
            break;
          case 'eose':
            eoseListeners.delete(cb as () => void);
            break;
        }
      },
    };
    return poolSub;
  }

  async get(relayUrls: string[], filter: Filter, opts?: SubscriptionOptions): Promise<Event | null> {
    const sub = await this.sub(relayUrls, [filter], opts);
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        sub.unsub();
        resolve(null);
      }, 1500);
      sub.on('event', (event: Event) => {
        resolve(event);
        clearTimeout(timeout);
        sub.unsub();
      });
    });
  }

  async list(relayUrls: string[], filters: Filter[], opts?: SubscriptionOptions): Promise<Event[]> {
    const sub = await this.sub(relayUrls, filters, opts);

    return new Promise(resolve => {
      const events: Event[] = [];

      sub.on('event', (event: Event) => {
        events.push(event);
      });
      // we can rely on an eose being emitted here because pool.sub() will fake one
      sub.on('eose', () => {
        sub.unsub();
        resolve(events);
      });
    });
  }

  // publish(relays: string[], event: Event): Pub[] {
  //   return relays.map((relay) => {
  //     const r = this._conn[normalizeURL(relay)];
  //     if (!r) return badPub(relay);
  //     const s = r.publish(event);
  //     return s;
  //   });
  // }

  seenOn(id: string): string[] {
    return Array.from(this.#seenOn[id]?.values?.() || []);
  }

  async close(relayUrls: string[]): Promise<void> {
    await Promise.all(
      relayUrls.map(url => {
        const relay = this.#availConns.get(utils.normalizeURL(url));
        if (relay) relay.close();
      })
    );
  }
}

// function badPub(relay: string): Pub {
//   return {
//     on(typ, cb) {
//       if (typ === "failed") cb(`relay ${relay} not connected`);
//     },
//     off() {},
//   };
// }
