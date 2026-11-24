import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs a DB query whenever the screen gains focus and whenever `params` changes,
 * so screens always show fresh data after navigating back from a form.
 * `params` must be JSON-serializable (id, search text, or a filters object); it is compared by value.
 * Results from superseded requests are discarded.
 */
export function useDbQuery<T, P = undefined>(query: (params: P) => Promise<T>, params?: P) {
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  const latestRequest = useRef(0);

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async (p: P) => {
    const request = ++latestRequest.current;
    setLoading(true);
    try {
      const result = await queryRef.current(p);
      if (request !== latestRequest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (request !== latestRequest.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  // Keyed by value so a new-but-equal filters object doesn't trigger a refetch on every render.
  const paramsKey = params === undefined ? undefined : JSON.stringify(params);
  const reload = useCallback(
    () => run((paramsKey === undefined ? undefined : JSON.parse(paramsKey)) as P),
    [run, paramsKey]
  );

  useFocusEffect(
    useCallback(() => {
      void reload(); // never rejects: errors are captured into `error`
    }, [reload])
  );

  return { data, error, loading, reload };
}
