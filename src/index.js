require("dotenv").config();
const awsIot = require('aws-iot-device-sdk');
const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

console.log(process.env.KEY_PATH);
console.log(process.env.CERT_PATH);
console.log(process.env.CA_PATH);
if(fs.existsSync(process.env.KEY_PATH) && fs.existsSync(process.env.CERT_PATH) && fs.existsSync(process.env.CA_PATH))
    console.log("Files exists");
else
    console.log("Files not exists");

const device = awsIot.device({
    host: process.env.AWS_IOT_ENDPOINT,
    clientId: process.env.AWS_IOT_CLIENT_ID,
    certPath: process.env.CERT_PATH,
    keyPath: process.env.KEY_PATH,
    region: process.env.AWS_REGION,
    caPath: process.env.CA_PATH,
});

// Configure AWS SDK
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();
const bucketName = process.env.S3_BUCKET;

console.log('Iniciando conexión a AWS IoT Core...');
device.on('connect', () => {
    console.log('Conectado a AWS IoT Core');
    device.subscribe(process.env.MQTT_TOPIC_IN);
});

device.on('message', async (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        if (!payload.s3Key) {
            console.error("Invalid payload:", payload);
            return;
        }

        console.log(`Processing file: ${payload.s3Key}`);
        await processAudio(payload);
    } catch (error) {
        console.error("Error processing message:", error);
    }
});

device.on('close', () => {
    console.log('Connection closed.');
});

device.on('reconnect', () => {
    console.log('Reconnecting...');
});

device.on('offline', () => {
    console.log('Connection is offline.');
});

device.on('error', (error) => {
    console.error('Connection Error:', error);
});


// Function to Process Audio
async function processAudio(payload) {
    try {
        const s3Key = payload.s3Key;
        const localFile = path.join(__dirname, payload.filename);
        const outputFile = path.join(__dirname, "output.mp3");

        // Step 1: Download from S3
        console.log(`Downloading ${s3Key} from S3...`);
        await downloadFromS3(s3Key, localFile);

        // Step 2: Convert to MP3 using FFmpeg
        console.log("Converting to MP3...");
        await convertToMp3(localFile, outputFile);

        // Step 3: Upload back to S3
        const newS3Key = s3Key.replace(".wav", ".mp3");
        console.log(`Uploading converted file to S3 as ${newS3Key}...`);
        await uploadToS3(newS3Key, outputFile);

        // Step 4: Cleanup
        fs.unlinkSync(localFile);
        fs.unlinkSync(outputFile);
        await deleteFile(s3Key);


        // Step 5: Publish to MQTT Topic
        const message = JSON.stringify({ ...payload, s3Key: newS3Key });
        device.publish(process.env.MQTT_TOPIC_OUT, message
            , function (err) {
                if (err) {
                    console.error('Error publishing message:', err);
                }
            });

        console.log("Processing complete.");
    } catch (error) {
        console.error("Error processing audio:", error);
    }
}

// Function to Download File from S3
async function downloadFromS3(s3Key, downloadPath) {
    return new Promise((resolve, reject) => {
        const params = { Bucket: process.env.S3_BUCKET, Key: s3Key };
        const fileStream = fs.createWriteStream(downloadPath);

        s3.getObject(params)
            .createReadStream()
            .on("error", reject)
            .pipe(fileStream)
            .on("close", resolve);
    });
}

// Function to Convert Audio to MP3
async function convertToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .output(outputPath)
            .audioCodec("libmp3lame")
            .on("end", resolve)
            .on("error", reject)
            .run();
    });
}

// Function to Upload File to S3
async function uploadToS3(s3Key, filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, (err, data) => {
            if (err) return reject(err);

            const params = {
                Bucket: process.env.S3_BUCKET,
                Key: s3Key,
                Body: data,
                ContentType: "audio/mpeg",
            };

            s3.upload(params, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });
    });
}

async function deleteFile(s3Key) {
    const params = {
        Bucket: bucketName,
        Key: s3Key,
    };

    try {
        await s3.deleteObject(params).promise();
        console.log(`🗑️ Deleted file: ${s3Key}`);
    } catch (error) {
        console.error("❌ Error deleting file:", error);
    }
}