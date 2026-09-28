export interface UploadResult {
  url: string;
}

// base64-in-JSON avoids pulling multer/busboy for one endpoint.
// 10MB cap on server side; client-side FileReader handles binary safely.
export async function uploadImage(file: File): Promise<UploadResult> {
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const res = await fetch("/api/uploads", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, name: file.name }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `upload failed: ${res.status}`);
  }
  return (await res.json()) as UploadResult;
}
