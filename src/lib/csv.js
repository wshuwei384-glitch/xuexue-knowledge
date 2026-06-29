export function toCsv(rows) {
  const headers = [
    "title",
    "content",
    "category_name",
    "tags",
    "importance",
    "status",
    "created_by_username",
    "created_at",
    "last_edited_by_username",
    "updated_at"
  ];

  const escapeCell = (value) => {
    const text = Array.isArray(value) ? value.join("|") : value ?? "";
    return `"${String(text).replaceAll('"', '""')}"`;
  };

  return [headers.join(","), ...rows.map((row) => headers.map((key) => escapeCell(row[key])).join(","))].join("\n");
}

export function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
