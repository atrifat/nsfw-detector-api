import urlRegexSafe from "url-regex-safe";
import * as fs from "node:fs";
import { exit } from "process";
import { spawn } from 'node:child_process';

export const isContentTypeImageType = function (contentType) {
  return contentType.includes("image");
};

export const isContentTypeVideoType = function (contentType) {
  return contentType.includes("video");
};

// Check url type
// Code is modified based on https://github.com/haorendashu/nostrmo/blob/main/lib/component/content/content_decoder.dart#L505
export const getUrlType = function (path) {
  var strs = path.split("?");
  var index = strs[0].lastIndexOf(".");
  if (index == -1) {
    return "unknown";
  }

  path = strs[0];
  var n = path.substring(index);
  n = n.toLowerCase();

  if (n == ".png" ||
    n == ".jpg" ||
    n == ".jpeg" ||
    n == ".gif" ||
    n == ".webp") {
    return "image";
  } else if (n == ".mp4" || n == ".mov" || n == ".wmv" || n == ".webm" || n == ".avi") {
    return "video";
  } else {
    return "link";
  }
}

export const extractUrl = function (text) {
  const matches = text.match(
    urlRegexSafe({ strict: true, localhost: false, returnString: false })
  );

  return matches;
};

export const cleanUrlWithoutParam = function (url) {
  const newUrl = new URL(url);
  newUrl.search = "";
  return newUrl.toString();
};

export const handleFatalError = function (err) {
  if (typeof err === "undefined") return;
  if (err === null) return;
  console.error(err);
  // force exit
  exit(1);
};

export async function deleteFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err) reject(err);
      resolve(true);
    });
  });
}

export async function moveFile(srcPath, dstPath) {
  return new Promise((resolve, reject) => {
    fs.rename(srcPath, dstPath, (err) => {
      if (err) reject(err);
      resolve(true);
    });
  });
}

export async function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code, error) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}.\nStderr: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

