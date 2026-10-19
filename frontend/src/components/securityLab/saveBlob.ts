/**
 * Hands a downloaded file to the browser's own save mechanism, through a temporary object URL and a link that is clicked
 * once. The URL is released straight away. This makes no request: the file was already fetched by the client module.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
