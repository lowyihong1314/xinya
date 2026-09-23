"""媒体文件的扩展名白名单（原 backend/app/media/constants.py，一字未改）。

三张表各有各的用处，**不要合并也不要"顺手补全"**：

  · ALLOWED_EXTENSIONS —— 上传时的准入名单（utils.allowed_file）。里面有 .svg / .raw，
    它们既不在 IMAGE_EXTS 也不在 VIDEO_EXTS，所以传得上去、但取图时会落到
    ``kind: "unsupported"`` 那一支（返回 broken-image）。这是现状，前端认这条分支。
  · IMAGE_EXTS —— 能进 JPEG 缓存流水线的位图格式。**不含 .heic/.heif**，
    那两个格式在代码里处处是单独的 ``ext in {".heic", ".heif"}`` 判断
    （走 pillow_heif 而不是 PIL.Image.open），把它们塞进 IMAGE_EXTS 会让那些分支失效。
  · VIDEO_EXTS —— 走 ffmpeg 转码的格式。
"""

ALLOWED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".heic",
    ".heif",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
    ".svg",
    ".raw",
    ".mp4",
    ".mov",
    ".mod",
    ".m4v",
    ".avi",
    ".mkv",
    ".webm",
    ".flv",
    ".mts",
    ".m2ts",
    ".3gp",
    ".wmv",
}

VIDEO_EXTS = {
    ".mp4",
    ".mov",
    ".mod",
    ".avi",
    ".mkv",
    ".flv",
    ".wmv",
    ".3gp",
    ".mts",
    ".m2ts",
    ".webm",
    ".m4v",
}

IMAGE_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
}
