# nsfw-detector-api

A simple PoC (Proof of Concept) NSFW Detector API Server using [NsfwSpy.js](https://github.com/NsfwSpy/NsfwSpy.js) model.

nsfw-detector-api is a core dependency of [nostr-filter-relay](https://github.com/atrifat/nostr-filter-relay).

## Getting Started

Published docker image is available in [ghcr.io](https://github.com/atrifat/nsfw-detector-api/pkgs/container/nsfw-detector-api).
Run it instantly:

```
docker run --init --rm -p 8081:8081 ghcr.io/atrifat/nsfw-detector-api:main
```

or using docker image with CUDA drivers included (marked with `cuda` suffix in the tag name) and [NVIDIA docker runtime (Container Toolkit)](https://github.com/NVIDIA/nvidia-container-toolkit) support:

```
docker run --gpus all --init --rm -p 8081:8081 ghcr.io/atrifat/nsfw-detector-api:main-cuda
```

You can also clone this repository to run or modify it locally

```
git clone https://github.com/atrifat/nsfw-detector-api
cd nsfw-detector-api
```

install its dependencies

```
npm install
```

and run it using command

```
npm run start
```

or run it using node command directly

```
node src/index.mjs
```

If you want to test the API server, you can use GUI tools like [Postman](https://www.postman.com/) or using curl.

Send request by using image URL:

```
curl --header "Content-Type: application/json" \
  --header "Authorization: Bearer myapitokenchangethislater" \
  --request POST \
  --data '{"url":"https://example.org/image.jpg"}' \
  http://localhost:8081/predict
```

or send request by using base64 string of the image:

```
curl --header "Content-Type: application/json" \
  --header "Authorization: Bearer myapitokenchangethislater" \
  --request POST \
  --data '{"data":"base64stringhere"}' \
  http://localhost:8081/predict_data
```

The output is JSON which consists of four predicted classes (based on [NsfwSpy.js](https://github.com/NsfwSpy/NsfwSpy.js)) as follows:

```
{
    "data": {
        "hentai": 0.00016754239914007485,
        "neutral": 0.9930612444877625,
        "pornography": 0.0058021554723382,
        "sexy": 0.0009690204169601202,
        "predictedLabel": "neutral"
    }
}
```

## Configuration

The following environment variables can be used to configure the API server:

*   `PORT`: The port the server listens on (default: 8081).
*   `API_TOKEN`: The API token for authentication (default: myapitokenchangethislater).
*   `ENABLE_API_TOKEN`: Enable or disable API token authentication (default: false).
*   `ENABLE_CONTENT_TYPE_CHECK`: Ensure content type check via header request (default: false).
*   `FFMPEG_PATH`: Set to other path for ffmpeg installed in system (example: /usr/bin/ffmpeg) otherwise automatically inferred from ffmpeg.path pre-installed dependency
*   `IMG_DOWNLOAD_PATH`: Directory to store temporary files (default: /tmp/).
*   `MAX_VIDEO_SIZE_MB`: Maximum size of video for classification in MB (default: 100).
*   `CACHE_DURATION_IN_SECONDS`: Duration of classification cache in seconds (default: 86400).
*   `MAX_CACHE_ITEM_NUM`: Maximum number of items in classification cache (default: 200000).
*   `REQUEST_TIMEOUT_IN_SECONDS`: Request timeout for downloading image or checking image header in seconds (default: 60).
*   `USER_AGENT`: User agent for downloading files (default: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36').

## License

MIT

## Author

- Rif'at Ahdi Ramadhani (atrifat)
- d00M_L0rDz (NsfwSpy)
