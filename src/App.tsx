import { Event, Kind, nip19 } from 'nostr-tools';
import { useCallback, useState } from 'react';
import './App.css';
import { useNip07ExtAvailability } from './nostr/Nip07ExtAvailability';
import { RelayPool } from './nostr/RelayPool';
import { FolloweeStats } from './types/FolloweeStats';

function App() {
  const isNip07ExtAvailable = useNip07ExtAvailability();
  const [pubkeyInput, setPubkeyInput] = useState('');

  const [followees, setFollowees] = useState<FolloweeStats[]>([]);
  const [message, setMessage] = useState('');

  const clearMessage = () => setMessage('');

  const handleClickGetFolloweesUsingManualInputPubkey = useCallback(async () => {
    const hexPubkey = verifyAndConvertToHexPubkey(pubkeyInput);
    if (hexPubkey === undefined) {
      setMessage('malformed pubkey!');
      return;
    }

    clearMessage();

    const followees = await getFollowees(pool, bootstrapRelays, hexPubkey);
    setFollowees(
      followees.map(pk => {
        return { pubkey: pk };
      })
    );
  }, [pubkeyInput]);

  const handleClickGetFolloweesUsingPubkeyInExt = useCallback(async () => {
    clearMessage();

    if (window.nostr.getPublicKey === undefined) {
      console.error('NIP-07 extension not found!');
      return;
    }
    const pk = await window.nostr.getPublicKey();

    const followees = await getFollowees(pool, bootstrapRelays, pk);
    setFollowees(
      followees.map(pk => {
        return { pubkey: pk };
      })
    );
  }, []);

  return (
    <div className="App">
      <h1>nostr-k3-sorter</h1>
      <p>Check and Manage your Followees on Nostr.</p>

      <div>
        <form>
          <input
            type="text"
            placeholder="npub or hex"
            value={pubkeyInput}
            onChange={e => setPubkeyInput(e.target.value)}
          ></input>
          <button type="button" onClick={handleClickGetFolloweesUsingManualInputPubkey}>
            Get Followees
          </button>
        </form>

        <button type="button" onClick={handleClickGetFolloweesUsingPubkeyInExt} disabled={!isNip07ExtAvailable}>
          Get Followees Using Pubkey in NIP-07 Extension
        </button>
      </div>
      <p>{message}</p>
      <div>
        {followees.map(f => (
          <div key={f.pubkey}>
            <pre> {f.pubkey}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;

const bootstrapRelays = [
  'wss://relay-jp.nostr.wirednet.jp',
  'wss://nostr.h3z.jp',
  'wss://nostr-relay.nokotaro.com',
  'wss://nostr.holybea.com',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://nos.lol',
];

const pool = new RelayPool();

const getLatestEventOfKinds = async (
  pool: RelayPool,
  relayUrls: string[],
  pubkey: string,
  kinds: Kind[],
  limit?: number
): Promise<Event | undefined> => {
  try {
    const evs = await pool.list(relayUrls, [{ authors: [pubkey], kinds, limit }]);
    const filtered = evs.filter(ev => kinds.includes(ev.kind));

    let latest: Event | undefined;
    for (const ev of filtered) {
      if (ev.created_at > (latest?.created_at ?? 0)) {
        latest = ev;
      }
    }
    return latest;
  } catch (err) {
    console.error(err);
    return undefined;
  }
};

const getFollowees = async (pool: RelayPool, relayUrls: string[], pubkey: string): Promise<string[]> => {
  const evContacts = await getLatestEventOfKinds(pool, relayUrls, pubkey, [Kind.Contacts]);
  if (evContacts === undefined) {
    return [];
  }
  const res = evContacts.tags.filter(t => t.length >= 2 && t[0] === 'p').map(t => t[1]);
  return res;
};

const verifyAndConvertToHexPubkey = (input: string): string | undefined => {
  if (input.startsWith('npub') && input.length === 63) {
    try {
      return decodeNpub(input);
    } catch (err) {
      console.error(err);
      return undefined;
    }
  }

  if (input.length === 64) {
    // maybe a hex pubkey
    // TODO: more elaborated check
    return input;
  }

  return undefined;
};

const decodeNpub = (npub: string): string => {
  const dec = nip19.decode(npub);
  switch (dec.type) {
    case 'npub':
      return dec.data as string;

    default:
      throw Error('not npub');
  }
};
