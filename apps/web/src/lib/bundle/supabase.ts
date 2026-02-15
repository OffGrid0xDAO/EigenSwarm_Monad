import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
    return typeof url === "string" && url.length > 0 && typeof anonKey === "string" && anonKey.length > 0;
}

export const supabase = isSupabaseConfigured()
    ? createClient(url!, anonKey!)
    : (null as ReturnType<typeof createClient> | null);

/** Storage bucket name for token logos (must match bucket in Supabase Dashboard → Storage) */
export const LOGOS_BUCKET =
    (process.env.NEXT_PUBLIC_SUPABASE_LOGOS_BUCKET as string | undefined)?.trim() || "logos";

/** Table name for launch records */
export const LAUNCHES_TABLE = "launches";

export interface LaunchRecord {
    creator_address: string;
    name: string;
    symbol: string;
    token_uri: string;
    tx_hash: string;
    recipients: { address: string; mon_amount: string }[];
    total_mon: string;
    slippage_bps: number;
}

export async function saveLaunch(record: LaunchRecord): Promise<{ error: Error | null }> {
    if (!supabase) {
        return { error: new Error("Supabase not configured") };
    }
    const { error } = await supabase.from(LAUNCHES_TABLE).insert(record);
    return { error: error ? new Error(error.message) : null };
}
