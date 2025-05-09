# ffmpeg-google-cloud-function
A Google Cloud Function for overlaying an avatar video and an audio track onto a background video using FFmpeg.

test
```
{
"backgroundVideoGcsPath": "gs://YOUR_INPUT_BUCKET_NAME/path/to/your/background_video.mp4",
"avatarVideoGcsPath": "gs://YOUR_INPUT_BUCKET_NAME/path/to/your/avatar_video.mov",
"audioGcsPath": "gs://YOUR_INPUT_BUCKET_NAME/path/to/your/audio_track.aac",
"outputGcsBucket": "YOUR_OUTPUT_BUCKET_NAME",
"outputGcsFileName": "processed_videos/my_output_video_with_avatar.mp4"
}
