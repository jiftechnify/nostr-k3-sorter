import { useCallback, useEffect, useRef, useState } from 'react';

const NUM_CHECKS_FOR_NIP07 = 3;

export const useNip07ExtAvailability = () => {
  const [isAvailable, setIsAvailable] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);
  const checkCnt = useRef(0);

  const check = useCallback(() => {
    checkCnt.current++;
    setIsAvailable(window.nostr !== undefined);

    if (checkCnt.current < NUM_CHECKS_FOR_NIP07) {
      timeoutRef.current = setTimeout(() => {
        check();
      }, 200);
    }
  }, []);

  useEffect(() => {
    if (checkCnt.current < NUM_CHECKS_FOR_NIP07) {
      timeoutRef.current = setTimeout(() => {
        check();
      }, 200);
    }

    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, [check]);

  return isAvailable;
};
