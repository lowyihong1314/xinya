// 解析桌面拖入的 DataTransfer：优先 webkitGetAsEntry 递归遍历目录，
// 不支持时退化为平铺 files 列表。返回文件与相对路径（供 /uploads 的 relative_paths[] 用）。
export async function collectDroppedFiles(
  dataTransfer: DataTransfer,
): Promise<{ files: File[]; relativePaths: string[] }> {
  const files: File[] = [];
  const relativePaths: string[] = [];

  const entries: FileSystemEntry[] = [];
  if (dataTransfer.items?.length) {
    for (const item of Array.from(dataTransfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }

  if (entries.length) {
    await Promise.all(entries.map((entry) => walkEntry(entry, "", files, relativePaths)));
    return { files, relativePaths };
  }

  for (const file of Array.from(dataTransfer.files || [])) {
    files.push(file);
    relativePaths.push(file.name);
  }
  return { files, relativePaths };
}

async function walkEntry(entry: FileSystemEntry, prefix: string, files: File[], relativePaths: string[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    ).catch(() => null);
    if (file) {
      files.push(file);
      relativePaths.push(prefix ? `${prefix}/${file.name}` : file.name);
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries 每次最多返回 100 条，需循环读到空为止
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)).catch(
        () => [] as FileSystemEntry[],
      );
      if (!batch.length) break;
      children.push(...batch);
    }
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    for (const child of children) {
      await walkEntry(child, nextPrefix, files, relativePaths);
    }
  }
}
