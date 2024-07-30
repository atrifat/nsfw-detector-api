import express from "express";
import bodyparser from 'body-parser';
import { NsfwSpy } from "./nsfw-detector.mjs";
import sharp from "sharp";
import { LRUCache } from "lru-cache";
import to from "await-to-js";
import { downloadFile, downloadPartFile, getContentInfo } from "./download.mjs";
import {
    extractUrl,
    isContentTypeImageType,
    isContentTypeVideoType,
    cleanUrlWithoutParam,
    handleFatalError,
    deleteFile,
    moveFile,
    getUrlType
} from "./util.mjs";
import * as ffmpeg from "@ffmpeg-installer/ffmpeg";
import { generateScreenshot } from "./ffmpeg-util.mjs";
import { sha256 } from "js-sha256";
import * as dotenv from 'dotenv';
import bearerToken from 'express-bearer-token';

// Load env variable from .env
dotenv.config()

// Generic error variable
let err;

// Load nsfw detection model
const nsfwSpy = new NsfwSpy(
    "file://models/mobilenet-v1.0.0/model.json"
);

const IMG_DOWNLOAD_PATH = process.env.IMG_DOWNLOAD_PATH ?? "/tmp/";

console.time("load model");
let statusLoad;
[err, statusLoad] = await to.default(nsfwSpy.load());
handleFatalError(err);

console.timeEnd("load model");

const CACHE_DURATION_IN_SECONDS = parseInt(process.env.CACHE_DURATION_IN_SECONDS || 86400);
const MAX_CACHE_ITEM_NUM = parseInt(process.env.MAX_CACHE_ITEM_NUM || 200000);
const resultCache = new LRUCache(
    {
        max: MAX_CACHE_ITEM_NUM,
        // how long to live in ms
        ttl: CACHE_DURATION_IN_SECONDS * 1000,
    },
);

const PORT = process.env.PORT || 8081;
const ENABLE_API_TOKEN = process.env.ENABLE_API_TOKEN ? process.env.ENABLE_API_TOKEN === 'true' : false;
const API_TOKEN = process.env.API_TOKEN || "myapitokenchangethislater";
const ENABLE_CONTENT_TYPE_CHECK = process.env.ENABLE_CONTENT_TYPE_CHECK ? process.env.ENABLE_CONTENT_TYPE_CHECK === 'true' : false;
const FFMPEG_PATH = process.env.FFMPEG_PATH || ffmpeg.path;
const MAX_VIDEO_SIZE_MB = parseInt(process.env.MAX_VIDEO_SIZE_MB || 100);
const REQUEST_TIMEOUT_IN_SECONDS = parseInt(process.env.REQUEST_TIMEOUT_IN_SECONDS || 60);

const app = express();

// Cleanup all temporary file
const cleanupTemporaryFile = async (filename) => {
    let deleteResult;
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename + "_" + "image"));
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename + "_" + "video"));
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));
    return true;
};

app.use(bodyparser.json({ limit: '5mb' }));

const reqLogger = function (req, _res, next) {
    console.info(`${req.method} request to "${req.url}" by ${req.hostname}`);
    next();
};

app.use(reqLogger);

// Simple authentication middleware
const authMiddleware = function (req, res, next) {
    if (ENABLE_API_TOKEN) {
        const token = typeof req.token !== 'undefined' ? req.token : null;
        if (!token) {
            const error = new Error('Missing API token');
            error.statusCode = 401
            return res.status(401).json({ "message": error.message });
        }

        if (API_TOKEN !== token) {
            const error = new Error('Invalid API token');
            error.statusCode = 401
            return res.status(401).json({ "message": error.message });
        }
    }
    next();
};

// Extract auth token if it is exist
app.use(bearerToken());

app.use(authMiddleware);

app.get("/", (req, res) => {
    res.status(200).json({ "data": "A PoC of NSFW detector, send your post url data to /predict to get prediction result" });
});

app.post("/predict", async (req, res) => {
    let err;

    const url = (typeof req.body.url !== 'undefined') ? req.body.url : "";
    // Check and make sure if it is valid and safe url
    const extractedUrl = extractUrl(url);
    if (extractedUrl === null) {
        err = new Error("URL is not detected");
        err.name = "ValidationError";
        return res.status(400).json({ "message": err.message });
    }

    // Check and reject if it has multiple url
    if (extractedUrl.length > 1) {
        err = new Error("Multiple URL is not supported");
        err.name = "ValidationError";
        return res.status(400).json({ "message": err.message });
    }

    if (ENABLE_CONTENT_TYPE_CHECK) {
        // Check metadata info before downloading
        let contentInfo;
        [err, contentInfo] = await to.default(getContentInfo(url, REQUEST_TIMEOUT_IN_SECONDS * 1000));

        if (err) {
            return res.status(400).json({ "message": err.message });
        }

        // Reject non image/video type data
        let isImageType = isContentTypeImageType(contentInfo.contentType);
        let isVideoType = isContentTypeVideoType(contentInfo.contentType);
        if (!(isImageType === true || isVideoType === true)) {
            console.debug(contentInfo);
            err = new Error("Only image/video URL is acceptable");
            err.name = "ValidationError";
            return res.status(400).json({ "message": err.message });
        }

        console.debug(contentInfo);
    }

    const filename = sha256(url);

    let cache = resultCache.get("url" + "-" + filename);
    // Return cache result immediately if it is exist
    if (cache) {
        return res.status(200).json({ "data": cache });
    }

    console.debug(url, "=", filename);

    let downloadStatus, screenshotStatus;

    let urlType = getUrlType(url);

    if (urlType === "video") {
        [err, downloadStatus] = await to.default(
            downloadPartFile(url, IMG_DOWNLOAD_PATH + filename + "_" + "video", MAX_VIDEO_SIZE_MB * 1024 * 1024, REQUEST_TIMEOUT_IN_SECONDS * 1000)
        );
        if (err) {
            // Cleanup all image file                                             
            await (cleanupTemporaryFile(filename));
            return res.status(500).json({ "message": err.message });
        }

        // Generate screenshot file for image classification
        [err, screenshotStatus] = await to.default(
            generateScreenshot(IMG_DOWNLOAD_PATH + filename + "_" + "video", IMG_DOWNLOAD_PATH + filename + ".jpg", FFMPEG_PATH)
        );

        await to.default(moveFile(IMG_DOWNLOAD_PATH + filename + ".jpg", IMG_DOWNLOAD_PATH + filename + "_" + "image"));

        if (err) {
            // Cleanup all image file                                             
            await (cleanupTemporaryFile(filename));
            return res.status(500).json({ "message": err.message });
        }
    }
    else {
        [err, downloadStatus] = await to.default(
            downloadFile(url, IMG_DOWNLOAD_PATH + filename + "_" + "image", REQUEST_TIMEOUT_IN_SECONDS * 1000)
        );
        if (err) {
            // Cleanup all image file                                             
            await (cleanupTemporaryFile(filename));
            return res.status(500).json({ "message": err.message });
        }
    }

    // handleFatalError(err);
    console.debug("downloadStatus" + "-" + filename, downloadStatus);

    // Load metadata for debugging
    const img = sharp(IMG_DOWNLOAD_PATH + filename + "_" + "image");
    let metadata;
    [err, metadata] = await to.default(img.metadata());

    if (err) {
        // Cleanup all image file                                             
        await (cleanupTemporaryFile(filename));
        return res.status(500).json({ "message": err.message });
    }

    console.time("Preprocess" + "-" + filename);
    let outputInfo;
    [err, outputInfo] = await to.default(
        // Resize to 224 px since it is the input size of model
        img.resize(224).jpeg().withMetadata().toFile(IMG_DOWNLOAD_PATH + filename + "_" + "final")
    );

    if (err) {
        // Cleanup all image file                                             
        await (cleanupTemporaryFile(filename));
        return res.status(500).json({ "message": err.message });
    }
    console.timeEnd("Preprocess" + "-" + filename);

    console.time("Classify" + "-" + filename);
    [err, cache] = await to.default(nsfwSpy.classifyImageFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));
    if (err) {
        // Cleanup all image file                                             
        await (cleanupTemporaryFile(filename));
        return res.status(500).json({ "message": err.message });
    }
    // Set cache result
    resultCache.set("url" + "-" + filename, cache);

    console.timeEnd("Classify" + "-" + filename);
    console.debug(cache);

    // Cleanup all image file                                             
    await (cleanupTemporaryFile(filename));

    res.status(200).json({ "data": cache });
});

app.post("/predict_data", async (req, res) => {
    let err;

    const base64_data = (typeof req.body.data !== 'undefined') ? req.body.data : null;

    if (base64_data === null) {
        err = new Error("Data input is empty, please send base64 string data as input");
        err.name = "ValidationError";
        return res.status(400).json({ "message": err.message });
    }

    const buffer = Buffer.from(base64_data, 'base64');

    const filename = sha256(base64_data);
    let cache = await keyv.get("data" + "-" + filename);
    // Return cache result immediately if it is exist
    if (cache) {
        return res.status(200).json({ "data": cache });
    }

    // Load metadata for debugging
    const img = sharp(buffer);
    let metadata;
    [err, metadata] = await to.default(img.metadata());

    if (err) return res.status(500).json({ "message": err.message });
    console.debug(metadata);

    console.time("Preprocess" + "-" + filename);
    let outputInfo;
    [err, outputInfo] = await to.default(
        // Resize to 224 px since it is the input size of model
        img.resize(224).jpeg().withMetadata().toFile(IMG_DOWNLOAD_PATH + filename + "_" + "final")
    );
    if (err) return res.status(500).json({ "message": err.message });
    console.timeEnd("Preprocess" + "-" + filename);

    console.time("Classify" + "-" + filename);
    [err, cache] = await to.default(nsfwSpy.classifyImageFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));
    if (err) return res.status(500).json({ "message": err.message });

    // Set cache result for 1 day
    await keyv.set("data" + "-" + filename, cache, 24 * 60 * 60 * 1000);

    console.timeEnd("Classify" + "-" + filename);
    console.debug(cache);

    // Cleanup image file
    let deleteResult;
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));

    res.status(200).json({ "data": cache });
});

app.listen(PORT, () => {
    console.log(`Listening on ${PORT} ...`);
});
