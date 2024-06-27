# nsfw-detector-api

A simple PoC (Proof of Concept) NSFW Detector API Server using [NsfwSpy.js](https://github.com/NsfwSpy/NsfwSpy.js) model. The goal of this PoC is to be a simple example of how to integrate existing ML model in API server.

nsfw-detector-api is a core dependency of [nostr-filter-relay](https://github.com/atrifat/nostr-filter-relay).

## Getting Started

Published docker image is available in [ghcr.io](https://github.com/atrifat/nsfw-detector-api/pkgs/container/nsfw-detector-api).
Run it instantly:

```
docker run --init --rm -p 8081:8081 ghcr.io/atrifat/nsfw-detector-api:latest
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

## License

MIT

## Author

- Rif'at Ahdi Ramadhani (atrifat)
- d00M_L0rDz (NsfwSpy)
