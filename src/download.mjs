import * as fs from "node:fs";
import axios from "axios";
import mime from "mime";

export const downloadFile = async function (src, dest) {
  return await axios({
    method: "GET",
    url: src,
    responseType: "stream",
  })
    .then(function (response) {
      if (
        response &&
        response.status === 200 &&
        typeof response.data !== "undefined" &&
        response.data !== null
      ) {
        let writer = fs.createWriteStream(dest);

        // pipe the result stream into a file on disc
        response.data.pipe(writer);

        // return a promise and resolve when download finishes
        return new Promise((resolve, reject) => {
          writer.on("finish", () => {
            resolve(true);
          });

          writer.on("error", (error) => {
            reject(error);
          });
        });
      }
    })
    .catch(function (e) {
      throw new Error(e);
    });
};

export const getContentInfo = async function (src) {
  return await axios({
    method: "HEAD",
    url: src,
  })
    .then(function (response) {
      if (
        response &&
        response.status === 200 &&
        typeof response.headers !== "undefined" &&
        response.headers !== null
      ) {
        const contentLength = response.headers["content-length"];
        const contentType = response.headers["content-type"];
        const extension = mime.extension(contentType);
        // console.log(response.headers);
        const output = {
          contentLength: contentLength ? parseInt(contentLength) : 0,
          contentType: contentType ? contentType : "application/octet-stream",
          extension: extension ? extension : "bin",
        };

        return output;
      }
    })
    .catch(function (e) {
      throw new Error(e);
    });
};

export const getPathType = function (path) {
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
  } else if (n == ".mp4" || n == ".mov" || n == ".wmv" || n == ".m3u8") {
    return "video";
  } else {
    return "link";
  }
}
