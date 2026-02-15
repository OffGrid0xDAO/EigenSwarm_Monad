/**
 * nad.fun API client — handles image upload, metadata upload, and salt mining
 * for proper token visibility on nad.fun
 */

const NADFUN_API = 'https://api.nadapp.net';

export async function uploadImageToNadFun(
  imageBuffer: Buffer,
  contentType: string,
): Promise<{ imageUri: string; isNsfw: boolean }> {
  console.log(`[NadFun] Uploading image (${imageBuffer.length} bytes, ${contentType})...`);
  const response = await fetch(`${NADFUN_API}/metadata/image`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(imageBuffer),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Image upload failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log(`[NadFun] Image URI: ${data.image_uri}`);
  return { imageUri: data.image_uri, isNsfw: data.is_nsfw };
}

export async function uploadMetadataToNadFun(params: {
  imageUri: string;
  name: string;
  symbol: string;
  description: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}): Promise<{ metadataUri: string }> {
  console.log(`[NadFun] Uploading metadata for ${params.name} (${params.symbol})...`);
  const response = await fetch(`${NADFUN_API}/metadata/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_uri: params.imageUri,
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      website: params.website ?? null,
      twitter: params.twitter ?? null,
      telegram: params.telegram ?? null,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Metadata upload failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log(`[NadFun] Metadata URI: ${data.metadata_uri}`);
  return { metadataUri: data.metadata_uri };
}

export async function mineSaltFromNadFun(params: {
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
}): Promise<{ salt: `0x${string}`; address: `0x${string}` }> {
  console.log(`[NadFun] Mining salt for creator=${params.creator.slice(0, 10)}...`);
  const response = await fetch(`${NADFUN_API}/token/salt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      metadata_uri: params.metadataUri,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Salt mining failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  console.log(`[NadFun] Salt: ${data.salt}, Predicted address: ${data.address}`);
  return {
    salt: data.salt as `0x${string}`,
    address: data.address as `0x${string}`,
  };
}

/**
 * Generate a placeholder SVG image for tokens without a custom image
 */
export function generatePlaceholderSvg(name: string, symbol: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a2e"/>
        <stop offset="50%" style="stop-color:#16213e"/>
        <stop offset="100%" style="stop-color:#0f3460"/>
      </linearGradient>
      <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#e94560"/>
        <stop offset="100%" style="stop-color:#533483"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#bg)" rx="64"/>
    <circle cx="256" cy="200" r="80" fill="none" stroke="url(#glow)" stroke-width="4"/>
    <circle cx="256" cy="200" r="40" fill="url(#glow)" opacity="0.3"/>
    <circle cx="256" cy="200" r="8" fill="#e94560"/>
    <circle cx="200" cy="260" r="30" fill="none" stroke="#533483" stroke-width="2" opacity="0.6"/>
    <circle cx="312" cy="260" r="30" fill="none" stroke="#533483" stroke-width="2" opacity="0.6"/>
    <circle cx="256" cy="310" r="30" fill="none" stroke="#533483" stroke-width="2" opacity="0.6"/>
    <line x1="256" y1="200" x2="200" y2="260" stroke="#e94560" stroke-width="1.5" opacity="0.5"/>
    <line x1="256" y1="200" x2="312" y2="260" stroke="#e94560" stroke-width="1.5" opacity="0.5"/>
    <line x1="256" y1="200" x2="256" y2="310" stroke="#e94560" stroke-width="1.5" opacity="0.5"/>
    <line x1="200" y1="260" x2="312" y2="260" stroke="#533483" stroke-width="1" opacity="0.3"/>
    <line x1="200" y1="260" x2="256" y2="310" stroke="#533483" stroke-width="1" opacity="0.3"/>
    <line x1="312" y1="260" x2="256" y2="310" stroke="#533483" stroke-width="1" opacity="0.3"/>
    <text x="256" y="420" font-family="monospace" font-size="48" font-weight="bold" fill="white" text-anchor="middle">${symbol.slice(0, 8)}</text>
    <text x="256" y="460" font-family="monospace" font-size="18" fill="#e94560" text-anchor="middle" opacity="0.8">${name.slice(0, 20)}</text>
  </svg>`;
  return Buffer.from(svg);
}
