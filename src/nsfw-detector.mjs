// The wrapper code below was fully based on NsfwSpyJs original code which changes dependency to support GPU acceleration if available
import * as tf from '@tensorflow/tfjs-node-gpu';
import * as fs from 'fs';

export class NsfwSpy {
    imageSize;
    modelPath;
    model;

    constructor(modelPath) {
        this.imageSize = 224;
        this.modelPath = modelPath;
        this.model = null;
    }

    async load(loadOptions) {
        this.model = await tf.loadGraphModel(this.modelPath, loadOptions);
    }

    async classifyImageFromByteArray(imageBuffer) {
        const outputs = tf.tidy(() => {
            if (!this.model) throw new Error("The NsfwSpy model has not been loaded yet.");

            const decodedImage = tf.node.decodeImage(imageBuffer, 3)
                .toFloat()
                .div(tf.scalar(255));

            const resizedImage = tf.image.resizeBilinear(decodedImage, [this.imageSize, this.imageSize], true);
            const image = resizedImage.reshape([1, this.imageSize, this.imageSize, 3]);

            return this.model.execute(
                { 'import/input': image },
                ['Score']
            );
        });

        let data;
        try {
            data = await outputs.data();
        }
        catch (e) {
            throw e;
        }
        finally {
            outputs.dispose();
        }

        let result = new NsfwSpyResult(data);
        return result;
    }

    async classifyImageFile(filePath) {
        const imageBuffer = await fs.readFileSync(filePath);
        return this.classifyImageFromByteArray(imageBuffer);
    }
}

export class NsfwSpyResult {
    hentai = 0.0;
    neutral = 0.0;
    pornography = 0.0;
    sexy = 0.0;
    predictedLabel = '';

    constructor(results) {
        this.hentai = results[0];
        this.neutral = results[1];
        this.pornography = results[2];
        this.sexy = results[3];
        this.predictedLabel = this.toDictionary()[0].key;
    }

    get isNsfw() {
        return this.neutral < 0.5;
    }

    toDictionary() {
        const dictionary = [
            { key: "hentai", value: this.hentai },
            { key: "neutral", value: this.neutral },
            { key: "pornography", value: this.pornography },
            { key: "sexy", value: this.sexy }
        ];

        return dictionary.sort((a, b) => {
            return b.value - a.value;
        });
    }
}
