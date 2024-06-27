import * as ffmpeg from "@ffmpeg-installer/ffmpeg";
import { runCommand } from "./util.mjs";

export const generateScreenshot = async (inputFile, outputFile, ffmpegPath = '') => {
    try {
        const ffmpegBinary = ffmpegPath !== '' ? ffmpegPath : ffmpeg.path;
        const result = await runCommand(ffmpegBinary, [
            "-ignore_unknown", "-y", "-an", "-dn",
            // "-max_error_rate", 0.5,
            "-i", inputFile, "-ss", "00:00:01", "-vf", "thumbnail",
            "-update", 1, "-frames:v", 1, outputFile
        ]);
        return true;
    }
    catch (err) {
        console.error(err.message);
        return false;
    }

};