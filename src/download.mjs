import * as fs from "node:fs";
import axios from "axios";
import mime from "mime";

export const downloadFile = async function (src, dest, headers) {
  return await axios({
    method: "GET",
    url: src,
    responseType: "stream",
    headers: headers
  })
    .then(function (response) {
      if (
        response &&
        (response.status === 200 || response.status === 206) &&
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

const saveOutput = async (outputFile, response, size) => {
  const writeStream = fs.createWriteStream(outputFile);
  response.data.pipe(writeStream);

  let receivedLength = 0;

  return new Promise((resolve, reject) => {
    response.data.on('data', (chunk) => {
      receivedLength += chunk.length;
      if (receivedLength > size) {
        // Abort the download immediately when downloaded file exceeds content length
        response.data.destroy();
        reject(new Error('Downloaded size exceeds content length.'));
      }
    });

    writeStream.on('finish', async () => {
      resolve(true);
    });

    writeStream.on("error", (error) => {
      reject(error);
    });
  });
};

export const downloadPartFile = async (url, outputFile, maxVideoSize) => {
  maxVideoSize = maxVideoSize !== undefined ? maxVideoSize : 1024 * 1024 * 100;

  let response = await axios.head(url);
  // console.log(response.headers);

  // Check and follow redirect if it is available
  if (response.headers.get('location') != undefined) {
    const newUrl = response.headers.get('location');
    // console.log("redirect", newUrl);
    url = newUrl;
    response = await axios.head(url);
  }

  const fileSize = parseInt(response.headers['content-length']);
  console.debug(url, "fileSize (MB)", (fileSize / (1024 * 1024)));

  // Download immediately if file is smaller than target partial size (1 MiB)
  if (fileSize < maxVideoSize) {
    // console.log("download immediately");
    const response = await axios.get(url, { responseType: 'stream' });
    await saveOutput(outputFile, response, fileSize);
    return true;
  }

  // Set range headers to download with partial bytes size
  const headers = {
    Range: `bytes=0-${maxVideoSize - 1}`
  };

  response = await axios.get(url, { headers, responseType: 'stream' });

  if (response.status === 206) {
    // console.log("Server returned partial content.");
    await saveOutput(outputFile, response, maxVideoSize);
    return true;
  } else if (response.status === 416) {
    console.error("Server does not support Range header request.");
    return false;
  }
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
