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

// Generic error variable
let err;

// Load nsfw detection model
const nsfwSpy = new NsfwSpy(
    "file://./models/mobilenet-v1.0.0/model.json"
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

const port = process.env.PORT || 8081;

const app = express();
app.use(bodyparser.json())

const reqLogger = function (req, _res, next) {
    console.info(`${req.method} request to "${req.url}" by ${req.hostname}`);
    next();
};

app.use(reqLogger);

app.get("/", (req, res) => {
    res.status(200).json({ "data": "A PoC of NSFW detector, send your post url data to /predict to get prediction result" });
});

app.post("/predict", async (req, res) => {
    let err;

    const url = req.body.url;
    // Check and make sure if it is valid and safe url
    const extractedUrl = extractUrl(url);

    // Check and reject if it has multiple url
    if (extractedUrl.length > 1) {
        err = new Error("Multiple URL Not supported");
        err.name = "ValidationError";
        return res.status(400).json({ "message": err.message });
    }

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

app.listen(port, () => {
    console.log(`Listening on ${port} ...`);
});