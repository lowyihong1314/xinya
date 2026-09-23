# Music

This package owns music upload, album management, download streaming, and WMA-to-MP3 cache transcoding.

## Files
- `routes.py`: Flask routes for `/music/*`.
- `services.py`: album and music CRUD logic.
- `storage.py`: filesystem paths, upload helpers, and download/transcode behavior.

## Notes
- External URL prefix stays `/music` for compatibility.
- `ffmpeg` is required at runtime for `.wma` download transcoding.
