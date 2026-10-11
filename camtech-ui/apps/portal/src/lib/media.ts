import type { MediaRef } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { mediaRoleLabel } from './labels';

/** Loads an image (or any blob) with the signed-in user's token. */
export type BlobLoader = (signal: AbortSignal) => Promise<Blob>;

/** An object URL for `blob`, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [state, setState] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setState({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return state && state.blob === blob ? state.url : null;
}

/**
 * Fetches a blob through the API client (bearer header) and exposes it as an object URL.
 * The Blob is cached by React Query under `key` (signed-out clears it), so remounts and repeated thumbnails reuse
 * it instead of downloading the image again. Each component makes its own object URL and revokes it when `key`
 * changes or it unmounts; the request is aborted when nothing waits for it any more.
 */
export function useBlobUrl(load: BlobLoader | null, key: string): { url: string | null; error: unknown; loading: boolean } {
  const q = useQuery({
    queryKey: ['auth-blob', key],
    // `load` is a new function on every render; `key` identifies what it loads.
    queryFn: ({ signal }) => load!(signal),
    enabled: !!load,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
  const url = useObjectUrl(q.data);
  return { url, error: q.error, loading: !!load && !q.isError && !url };
}

export interface GalleryItem {
  key: string;
  label: ReactNode;
  load: BlobLoader;
  purged?: boolean;
}

/** Gallery items for document images (GET /media/{id}). */
export function documentImages(media: MediaRef[] | undefined): GalleryItem[] {
  return (media ?? []).map((m) => ({
    key: `media-${m.id}`,
    label: mediaRoleLabel(m.role),
    load: (signal: AbortSignal) => api.media(m.id, signal),
    purged: m.purged,
  }));
}
