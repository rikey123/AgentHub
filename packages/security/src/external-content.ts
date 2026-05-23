const closingExternalContentTag = /<\/external_content>/giu;

export function wrapExternalContent(path: string, content: string): string {
  const escapedContent = content.replace(closingExternalContentTag, "&lt;/external_content&gt;");
  return `<external_content path="${escapeAttribute(path)}">${escapedContent}</external_content>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
