import { isTauriRuntime } from "./persistence";

function extensionOf(filename: string): string {
  return filename.split(".").at(-1)?.toLowerCase() || "txt";
}

export async function saveLocalFile(filename: string, content: string | Blob, mime = "text/plain"): Promise<boolean> {
  if (isTauriRuntime()) {
    const [{ save }, { writeFile, writeTextFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const extension = extensionOf(filename);
    const path = await save({ defaultPath: filename, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!path) return false;
    if (typeof content === "string") await writeTextFile(path, content);
    else await writeFile(path, new Uint8Array(await content.arrayBuffer()));
    return true;
  }
  const blob = typeof content === "string" ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
}
