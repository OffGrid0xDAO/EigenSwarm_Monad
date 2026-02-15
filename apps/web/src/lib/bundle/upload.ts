import { supabase, isSupabaseConfigured, LOGOS_BUCKET } from "./supabase";

export function isUploadConfigured(): boolean {
    return isSupabaseConfigured() && supabase !== null;
}

/**
 * Upload an image file to Supabase Storage. Returns the public URL for the image.
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in env.
 * Create a bucket named "logos" in Supabase Dashboard (Storage) and set it to public.
 */
export async function uploadImageToSupabase(file: File): Promise<string> {
    if (!supabase) {
        throw new Error(
            "Upload is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env."
        );
    }

    const ext = file.name.split(".").pop() || "png";
    const path = `${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from(LOGOS_BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
    });

    if (error) {
        const msg =
            error.message === "Bucket not found"
                ? `Bucket "${LOGOS_BUCKET}" not found. In Supabase Dashboard → Storage, check the bucket name matches exactly, or set NEXT_PUBLIC_SUPABASE_LOGOS_BUCKET in .env to your bucket name.`
                : error.message || "Upload failed.";
        throw new Error(msg);
    }

    const {
        data: { publicUrl },
    } = supabase.storage.from(LOGOS_BUCKET).getPublicUrl(path);
    return publicUrl;
}
