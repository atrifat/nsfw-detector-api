import urlRegexSafe from "url-regex-safe";
import * as fs from "node:fs";
import { exit } from "process";

export const isContentTypeImageType = function (contentType) {
  return contentType.includes("image");
};

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

