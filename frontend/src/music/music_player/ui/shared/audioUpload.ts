const musicAudioUploadExtensions = [
  ".mp3",
  ".mp4",
  ".wav",
  ".wave",
  ".wma",
  ".m4a",
  ".m4b",
  ".aac",
  ".ogg",
  ".oga",
  ".flac",
  ".opus",
  ".webm",
  ".aif",
  ".aiff",
  ".amr",
  ".3gp",
  ".3g2",
];

export const musicAudioUploadAccept = [
  "audio/*",
  "video/mp4",
  "video/webm",
  ...musicAudioUploadExtensions,
].join(",");
