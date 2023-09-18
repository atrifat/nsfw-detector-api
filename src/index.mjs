import express from "express";
import bodyparser from 'body-parser';
import { NsfwSpy } from "@nsfwspy/node";
import sharp from "sharp";
import Keyv from "keyv";
import to from "await-to-js";
import { downloadFile, getContentInfo } from "./download.mjs";
import {
    extractUrl,
    isContentTypeImageType,
    cleanUrlWithoutParam,
    handleFatalError,
    deleteFile
} from "./util.mjs";
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

const IMG_DOWNLOAD_PATH = "/tmp/";

console.time("load model");
let statusLoad;
[err, statusLoad] = await to.default(nsfwSpy.load());
handleFatalError(err);

console.timeEnd("load model");

// const Keyv = require('keyv');
const keyv = new Keyv();

// Handle connection errors
keyv.on("error", (err) => console.log("Connection Error", err));

const PORT = process.env.PORT || 8081;
const ENABLE_API_TOKEN = process.env.ENABLE_API_TOKEN ? process.env.ENABLE_API_TOKEN === 'true' : false;
const API_TOKEN = process.env.API_TOKEN || "myapitokenchangethislater";
const ENABLE_CONTENT_TYPE_CHECK = process.env.ENABLE_CONTENT_TYPE_CHECK ? process.env.ENABLE_CONTENT_TYPE_CHECK === 'true' : true;

const app = express();
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
        [err, contentInfo] = await to.default(getContentInfo(url));

        if (err) {
            return res.status(400).json({ "message": err.message });
        }

        // Reject non image type data
        let isImageType = isContentTypeImageType(contentInfo.contentType);
        if (!isImageType) {
            err = new Error("Only image URL is acceptable");
            err.name = "ValidationError";
            return res.status(400).json({ "message": err.message });
        }

        console.debug(isImageType);
        console.debug(contentInfo);
    }

    const filename = sha256(url);

    let cache = await keyv.get("url" + "-" + filename);
    // Return cache result immediately if it is exist
    if (cache) {
        return res.status(200).json({ "data": cache });
    }

    let downloadStatus;
    [err, downloadStatus] = await to.default(
        downloadFile(url, IMG_DOWNLOAD_PATH + filename)
    );
    if (err) return res.status(500).json({ "message": err.message });
    // handleFatalError(err);
    console.debug(downloadStatus);

    // Load metadata for debugging
    const img = sharp(IMG_DOWNLOAD_PATH + filename);
    let metadata;
    [err, metadata] = await to.default(img.metadata());

    if (err) return res.status(500).json({ "message": err.message });
    console.debug(metadata);

    console.time("Preprocess");
    let outputInfo;
    [err, outputInfo] = await to.default(
        // Resize to 224 px since it is the input size of model
        img.resize(224).jpeg().withMetadata().toFile(IMG_DOWNLOAD_PATH + filename + "_" + "final")
    );
    if (err) return res.status(500).json({ "message": err.message });
    console.timeEnd("Preprocess");

    console.time("Classify");
    [err, cache] = await to.default(nsfwSpy.classifyImageFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));
    if (err) return res.status(500).json({ "message": err.message });
    // Set cache result for 1 day
    await keyv.set("url" + "-" + filename, cache, 24 * 60 * 60 * 1000);

    console.timeEnd("Classify");
    console.debug(cache);

    // Cleanup image file
    let deleteResult;
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename));
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));

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

    console.time("Preprocess");
    let outputInfo;
    [err, outputInfo] = await to.default(
        // Resize to 224 px since it is the input size of model
        img.resize(224).jpeg().withMetadata().toFile(IMG_DOWNLOAD_PATH + filename + "_" + "final")
    );
    if (err) return res.status(500).json({ "message": err.message });
    console.timeEnd("Preprocess");

    console.time("Classify");
    [err, cache] = await to.default(nsfwSpy.classifyImageFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));
    if (err) return res.status(500).json({ "message": err.message });

    // Set cache result for 1 day
    await keyv.set("data" + "-" + filename, cache, 24 * 60 * 60 * 1000);

    console.timeEnd("Classify");
    console.debug(cache);

    // Cleanup image file
    let deleteResult;
    [err, deleteResult] = await to.default(deleteFile(IMG_DOWNLOAD_PATH + filename + "_" + "final"));

    res.status(200).json({ "data": cache });
});

app.listen(PORT, () => {
    console.log(`Listening on ${PORT} ...`);
});