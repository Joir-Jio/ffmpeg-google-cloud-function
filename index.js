const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const ffmpeg = require('fluent-ffmpeg');       // Require fluent-ffmpeg
const ffmpeg_static = require('ffmpeg-static'); // Require ffmpeg-static
// const ffprobe_static = require('ffprobe-static'); // Optional: for ffprobe

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const storage = new Storage();

// --- Set fluent-ffmpeg to use binaries from npm packages ---
// This should be done once, ideally at the top level or during function initialization
if (ffmpeg_static) { // Check if the module is loaded (it should be if installed)
    ffmpeg.setFfmpegPath(ffmpeg_static); // Pass the path string from ffmpeg-static
    console.log("ffmpeg path set from ffmpeg-static:", ffmpeg_static);
} else {
    console.error("ffmpeg-static not found! Ensure it's installed.");
}

// Optional: Set ffprobe path
// if (ffprobe_static && ffprobe_static.path) {
//     ffmpeg.setFfprobePath(ffprobe_static.path);
//     console.log("ffprobe path set from ffprobe-static:", ffprobe_static.path);
// } else {
//     console.warn("ffprobe-static not found or path missing. Some fluent-ffmpeg features might not work.");
// }


functions.http('processVideoFluentNpm', async (req, res) => {
    const jobId = uuidv4();
    console.log(`[${jobId}] Received request (fluent-ffmpeg with npm binaries).`);

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const {
        backgroundVideoGcsPath,
        avatarVideoGcsPath,
        audioGcsPath,
        outputGcsBucket,
        outputGcsFileName
    } = req.body;

    if (!backgroundVideoGcsPath || !avatarVideoGcsPath || !audioGcsPath || !outputGcsBucket || !outputGcsFileName) {
        return res.status(400).json({ jobId, error: 'Missing required GCS paths or output parameters.' });
    }

    const tempDir = path.join(os.tmpdir(), jobId);
    const localBackgroundPath = path.join(tempDir, 'background_in.mp4');
    const localAvatarPath = path.join(tempDir, 'avatar_in.mp4');
    const localAudioPath = path.join(tempDir, 'audio_in.aac');
    const localOutputPath = path.join(tempDir, 'output_processed_fluent_npm.mp4');

    try {
        await fs.mkdir(tempDir, { recursive: true });

        // No need to chmod ffmpeg, as ffmpeg-static should provide an executable binary.

        // --- 1. Download files ---
        console.log(`[${jobId}] Downloading files...`);
        await downloadFromGCS(backgroundVideoGcsPath, localBackgroundPath);
        await downloadFromGCS(avatarVideoGcsPath, localAvatarPath);
        await downloadFromGCS(audioGcsPath, localAudioPath);
        console.log(`[${jobId}] Files downloaded.`);

        // --- 2. Process video with fluent-ffmpeg ---
        console.log(`[${jobId}] Starting FFmpeg processing with fluent-ffmpeg...`);
        await new Promise((resolve, reject) => {
            ffmpeg() // fluent-ffmpeg will use the path set by setFfmpegPath
                .input(localBackgroundPath)
                .input(localAvatarPath)
                .input(localAudioPath)
                .complexFilter([
                    "[1:v]scale=100:-1[avatar]",
                    "[0:v][avatar]overlay=main_w-overlay_w-10:main_h-overlay_h-10[video_out]",
                    "[2:a]anull[audio_out]"
                ])
                .outputOptions([
                    '-map [video_out]',
                    '-map [audio_out]',
                    '-c:v libx264',
                    '-preset fast',
                    '-c:a aac',
                    '-shortest'
                ])
                .output(localOutputPath)
                .on('start', (commandLine) => {
                    console.log(`[${jobId}] Spawned FFmpeg with command: ${commandLine}`);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`[${jobId}] FFmpeg Processing: ${progress.percent.toFixed(2)}% done`);
                    }
                })
                .on('stderr', function(stderrLine) {
                    console.error(`[${jobId}] FFmpeg stderr: ${stderrLine}`);
                })
                .on('end', () => {
                    console.log(`[${jobId}] FFmpeg processing finished successfully.`);
                    resolve();
                })
                .on('error', (err, stdout, stderr) => {
                    console.error(`[${jobId}] FFmpeg error:`, err.message);
                    if (stdout) console.error(`[${jobId}] FFmpeg stdout (on error): ${stdout}`);
                    if (stderr) console.error(`[${jobId}] FFmpeg stderr (on error): ${stderr}`);
                    reject(new Error(`FFmpeg failed: ${err.message}`));
                })
                .run();
        });

        // --- 3. Upload processed file ---
        // ... (same as before) ...
        const destinationGcsPath = outputGcsFileName;
        console.log(`[${jobId}] Uploading ${localOutputPath} to gs://${outputGcsBucket}/${destinationGcsPath}`);
        await storage.bucket(outputGcsBucket).upload(localOutputPath, {
            destination: destinationGcsPath,
            metadata: { contentType: 'video/mp4' }
        });
        const finalGcsPath = `gs://${outputGcsBucket}/${destinationGcsPath}`;
        console.log(`[${jobId}] Upload successful: ${finalGcsPath}`);

        res.status(200).json({ jobId, message: 'Video processed successfully (fluent/npm).', outputGcsPath: finalGcsPath });


    } catch (error) {
        console.error(`[${jobId}] Error during processing:`, error);
        res.status(500).json({ jobId, error: 'Failed to process video.', details: error.message || 'Unknown error' });
    } finally {
        // --- 4. Cleanup ---
        // ... (same as before) ...
        try {
            if (await fs.stat(tempDir).catch(() => false)) {
                await fs.rm(tempDir, { recursive: true, force: true });
                console.log(`[${jobId}] Cleaned up temp directory: ${tempDir}`);
            }
        } catch (cleanupError) {
            console.error(`[${jobId}] Error during cleanup:`, cleanupError);
        }
    }
});

async function downloadFromGCS(gcsPath, localDestination) {
    // ... (same as before) ...
    const [bucketName, ...filePathParts] = gcsPath.replace('gs://', '').split('/');
    const fileName = filePathParts.join('/');
    if (!bucketName || !fileName) {
        throw new Error(`Invalid GCS path: ${gcsPath}`);
    }
    await storage.bucket(bucketName).file(fileName).download({ destination: localDestination });
}
