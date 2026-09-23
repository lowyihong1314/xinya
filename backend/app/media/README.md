# Media Module

Handles event media browsing, upload, conversion, thumbnails, and file serving metadata.

## Files

- `routes.py`: HTTP endpoints for media and media file serving.
- `services.py`: event-media business logic and video conversion flow.
- `utils.py`: ffmpeg/pillow helpers and archive helpers.
- `paths.py`: media storage path helpers.
- `constants.py`: supported file extensions.
- `video_tasks.py`: in-memory task state for active video conversion jobs.

## Main Routes

- `GET /media_file/<path>`
- `GET /media/get_event_type/<id>`
- `GET /media/get_event_image/<id>/<type>`
- `POST /media/upload_media`
- `POST /media/rotate_file/<file_id>/<angle>`
- `DELETE /media/delete_file/<file_id>`
- `DELETE /media/delete_files`
- `POST /media/download_files`

## Notes

- URL shape stays compatible with the legacy frontend.
- The module is already migrated from `function/media.py`.
- Keep ffmpeg/pillow specifics out of `routes.py`.
