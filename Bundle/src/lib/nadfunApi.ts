/**
 * Nad.fun official API client for token creation.
 * Uses the same endpoints as @nadfun/sdk so tokens are supported on nad.fun.
 * @see https://github.com/Naddotfun/nadfun-sdk-typescript
 */

const NAD_FUN_API: Record<number, string> = {
  143: 'https://api.nadapp.net',       // Monad mainnet
  10143: 'https://dev-api.nad.fun',   // Monad testnet (if needed)
};

export interface UploadImageResult {
  imageUri: string;
  isNsfw: boolean;
}

export interface UploadMetadataParams {
  imageUri: string;
  name: string;
  symbol: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}

export interface UploadMetadataResult {
  metadataUri: string;
}

export interface MineSaltParams {
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
}

export interface MineSaltResult {
  salt: `0x${string}`;
  address: string;
}

export function getNadFunApiBaseUrl(chainId: number): string | null {
  return NAD_FUN_API[chainId] ?? null;
}

export function isNadFunApiAvailable(chainId: number): boolean {
  return getNadFunApiBaseUrl(chainId) != null;
}

/** Upload logo image to nad.fun; returns image_uri for metadata step. */
export async function uploadImage(
  chainId: number,
  image: Blob,
  contentType: string
): Promise<UploadImageResult> {
  const base = getNadFunApiBaseUrl(chainId);
  if (!base) throw new Error('Nad.fun API is not available for this chain.');
  const res = await fetch(`${base}/metadata/image`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: image,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || res.statusText || 'Image upload failed');
  }
  const data = (await res.json()) as { image_uri: string; is_nsfw: boolean };
  return { imageUri: data.image_uri, isNsfw: data.is_nsfw };
}

/** Upload token metadata; returns metadata_uri for create + salt step. */
export async function uploadMetadata(
  chainId: number,
  params: UploadMetadataParams
): Promise<UploadMetadataResult> {
  const base = getNadFunApiBaseUrl(chainId);
  if (!base) throw new Error('Nad.fun API is not available for this chain.');
  const res = await fetch(`${base}/metadata/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_uri: params.imageUri,
      name: params.name,
      symbol: params.symbol,
      description: params.description ?? '',
      website: params.website ?? null,
      twitter: params.twitter ?? null,
      telegram: params.telegram ?? null,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || res.statusText || 'Metadata upload failed');
  }
  const data = (await res.json()) as { metadata_uri: string };
  return { metadataUri: data.metadata_uri };
}

/** Mine salt for token creation (vanity address); required for official create. */
export async function mineSalt(
  chainId: number,
  params: MineSaltParams
): Promise<MineSaltResult> {
  const base = getNadFunApiBaseUrl(chainId);
  if (!base) throw new Error('Nad.fun API is not available for this chain.');
  const res = await fetch(`${base}/token/salt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      metadata_uri: params.metadataUri,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || res.statusText || 'Salt mining failed');
  }
  const data = (await res.json()) as { salt: string; address: string };
  return { salt: data.salt as `0x${string}`, address: data.address };
}
